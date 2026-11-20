/**
 * bench:nsr: vazão ponta a ponta da atribuição de NSR (entradas -> fila -> worker -> registros).
 *
 * Fica em tests/e2e/scripts (e não em bench/nsr) porque reaproveita a infraestrutura de
 * Testcontainers e a montagem do worker real do pacote @genus/e2e; `bench/` é Python/dados e
 * fica fora do lint e do workspace.
 *
 * Uso: pnpm bench:nsr -- --n 200 --concurrency 4
 * Sem a flag --save, nada é gravado em disco. Com --save, escreve em bench/results/ (ignorado pelo git).
 * Nada impresso contém URL, senha ou CPF.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { punchJobId } from '@genus/queue';
import pg from 'pg';
import { chainReport, range } from '../support/asserts';
import { startInfra, waitFor, scalar } from '../support/infra';
import { enqueuePunch, openQueues, startRepCore, totalJobs } from '../support/stack';

const MIN_N = 200;
const MAX_N = 2000;
const TENANT = 1;
const ESTABLISHMENT = 9001;
const DEVICE = 9101;

interface Args {
  n: number;
  concurrency: number;
  save: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { n: 200, concurrency: 4, save: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    if (a === '--n') out.n = Number(argv[++i]);
    else if (a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '--save') out.save = true;
    else throw new Error(`Argumento desconhecido: ${String(a)}`);
  }
  if (!Number.isInteger(out.n) || out.n < MIN_N || out.n > MAX_N) {
    throw new Error(`--n deve ser inteiro entre ${MIN_N} e ${MAX_N}.`);
  }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 64) {
    throw new Error('--concurrency deve ser inteiro entre 1 e 64.');
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

const fmt = (ms: number) => ms.toFixed(2).replace('.', ',');

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? Number.NaN,
  };
}

const out = (line = '') => void process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  out(`Benchmark do NSR: ${args.n} batidas, ${args.concurrency} workers`);
  out('Subindo Postgres e Valkey (Testcontainers)...');
  const infra = await startInfra({ corePoolMax: args.concurrency + 4 });
  const queues = await openQueues(infra.valkey.url);
  let core: ReturnType<typeof startRepCore> | undefined;
  try {
    // Entradas semeadas como `arp_collector` (mesmo papel da API), em lote.
    const seqs = range(1, args.n);
    const marks = seqs.map((i) => new Date(Date.UTC(2026, 10, 20, 12, 0, 0) + i * 100).toISOString());
    const cpfs = seqs.map((i) => String(10000000000 + (i % 1000)));
    const client = new pg.Client({ connectionString: infra.db.collectorUrl });
    await client.connect();
    let entryIds: number[];
    try {
      const res = await client.query<{ id: string }>(
        `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id,
                               cpf, marcado_em, recebido_em, metodo_identificacao, nota_reconhecimento, nota_vivacidade)
         SELECT $1, $2, $3, s.seq, 1, s.cpf, s.marcado::timestamptz, s.marcado::timestamptz, 'facial', 0.9, 0.95
           FROM unnest($4::bigint[], $5::text[], $6::text[]) AS s(seq, marcado, cpf)
          ORDER BY s.seq
         RETURNING id`,
        [TENANT, ESTABLISHMENT, DEVICE, seqs, marks, cpfs],
      );
      entryIds = res.rows.map((r) => Number(r.id));
    } finally {
      await client.end();
    }

    // Worker sobe antes: o relógio começa quando os jobs entram na fila.
    core = startRepCore(infra, { concurrency: args.concurrency });
    const started = performance.now();
    await Promise.all(
      entryIds.map((entryId, i) =>
        enqueuePunch(
          queues,
          { entryId, tenantId: TENANT, establishmentId: ESTABLISHMENT },
          punchJobId(DEVICE, i + 1),
        ),
      ),
    );
    const enqueuedAt = performance.now();

    await waitFor(
      async () =>
        (await scalar(infra.owner, `SELECT count(*) AS n FROM entradas WHERE estabelecimento_id = $1 AND status = 'processado'`, [ESTABLISHMENT])) === args.n,
      `${args.n} entradas processadas`,
      600_000,
    );
    const committedAt = performance.now();
    await waitFor(async () => (await totalJobs(queues.postPunch)) === args.n * 3, `${args.n * 3} jobs em post-punch`, 120_000);
    const publishedAt = performance.now();

    const processed = core.logs.byEvent('punch_processed');
    const txMs = processed.map((l) => Number(l['txMs']));
    const lockWaitMs = processed.map((l) => Number(l['lockWaitMs']));
    const totalMs = processed.map((l) => Number(l['totalMs']));
    const publishFailures = processed.reduce((acc, l) => acc + Number(l['publishFailures'] ?? 0), 0);
    const tx = stats(txMs);
    const lock = stats(lockWaitMs);
    const total = stats(totalMs);

    const { report, invariant } = await chainReport(infra, TENANT, ESTABLISHMENT);
    const postPunchJobs = await totalJobs(queues.postPunch);
    const failed = (await queues.punches.getJobCounts('failed'))['failed'] ?? 0;

    const commitSeconds = (committedAt - started) / 1000;
    const e2eSeconds = (publishedAt - started) / 1000;
    const summary = {
      batidas: args.n,
      workers: args.concurrency,
      enfileiramentoMs: Number((enqueuedAt - started).toFixed(2)),
      ateCommitMs: Number((committedAt - started).toFixed(2)),
      ateFilaPostPunchMs: Number((publishedAt - started).toFixed(2)),
      vazaoCommitPorSegundo: Number((args.n / commitSeconds).toFixed(2)),
      vazaoPontaAPontaPorSegundo: Number((args.n / e2eSeconds).toFixed(2)),
      txMs: tx,
      lockWaitMs: lock,
      jobTotalMs: total,
      jobsPostPunch: postPunchJobs,
      jobsPunchesFalhos: failed,
      falhasDePublicacao: publishFailures,
      cadeiaOk: report.ok,
      invarianteOk: invariant.length === 0,
    };

    out('');
    out('===== Resumo: bench:nsr =====');
    out(`Batidas processadas ........ ${args.n}`);
    out(`Workers (concorrência) ..... ${args.concurrency}`);
    out(`Tempo até o COMMIT de todas  ${fmt(committedAt - started)} ms`);
    out(`Tempo até 3N jobs na fila .. ${fmt(publishedAt - started)} ms`);
    out(`Vazão até o COMMIT ......... ${fmt(args.n / commitSeconds)} batidas/s`);
    out(`Vazão ponta a ponta ........ ${fmt(args.n / e2eSeconds)} batidas/s (entrada na fila até 3N jobs em post-punch)`);
    out('Tempo da transação (txMs do assignNsr):');
    out(`  p50 ${fmt(tx.p50)} ms | p95 ${fmt(tx.p95)} ms | p99 ${fmt(tx.p99)} ms | máx ${fmt(tx.max)} ms`);
    out('Espera de trava (lockWaitMs):');
    out(`  p50 ${fmt(lock.p50)} ms | p95 ${fmt(lock.p95)} ms | p99 ${fmt(lock.p99)} ms | máx ${fmt(lock.max)} ms`);
    out('Tempo total do job no worker (transação + publicação):');
    out(`  p50 ${fmt(total.p50)} ms | p95 ${fmt(total.p95)} ms | p99 ${fmt(total.p99)} ms | máx ${fmt(total.max)} ms`);
    out(`Jobs em post-punch ......... ${postPunchJobs} (esperado ${args.n * 3})`);
    out(`Jobs punches falhos ........ ${failed}`);
    out(`Falhas de publicação ....... ${publishFailures}`);
    out(`Cadeia de hash ............. ${report.ok ? 'íntegra' : 'COM ERRO'} (${report.rowsChecked} registros, último NSR ${report.lastNsr})`);
    out(`Invariante processado ...... ${invariant.length === 0 ? 'íntegro' : 'COM ERRO'}`);
    out('Observação: Postgres e Valkey em contêineres locais, 1 estabelecimento (pior caso de trava), engine fora do caminho.');
    out('=============================');

    if (args.save) {
      const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../bench/results');
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `bench-nsr-n${args.n}-c${args.concurrency}.json`);
      writeFileSync(file, JSON.stringify(summary, null, 2));
      out(`Resultado gravado em bench/results/${path.basename(file)}`);
    }

    if (!report.ok || invariant.length > 0 || postPunchJobs !== args.n * 3 || failed > 0) process.exitCode = 1;
  } finally {
    await core?.close().catch(() => undefined);
    await queues.close().catch(() => undefined);
    await infra.stop().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Falha no benchmark: ${err instanceof Error ? err.name : 'erro desconhecido'}\n`);
  process.exitCode = 1;
});
