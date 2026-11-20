import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { createLogger } from '@genus/shared';
import { assignNsr } from '../src/nsr/assign-nsr';
import { evaluateInvariant } from '../src/nsr/check-invariant';
import { runVerifyChain } from '../src/cli/run-verify-chain';
import { seedEntries, TickingClock } from './support/arp-fixtures';

const logger = createLogger({ level: 'silent', service: 'rep-core-test' });

let db: ArpTestDatabase;
let core: pg.Pool;

beforeAll(async () => {
  db = await startArpTestDatabase();
  core = new pg.Pool({ connectionString: db.coreUrl, max: 4 });
});

afterAll(async () => {
  await core?.end();
  await db?.stop();
});

async function run(args: string[], env: Record<string, string | undefined> = { ARP_READER_DATABASE_URL: db.readerUrl }) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runVerifyChain({
    argv: args,
    env,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('runVerifyChain', () => {
  it('cadeia íntegra: exit 0 e resumo em pt-BR', async () => {
    const ids = await seedEntries(db.collectorUrl, { tenantId: 1, establishmentId: 701, deviceId: 701, count: 5 });
    const clock = new TickingClock();
    for (const entryId of ids) await assignNsr(core, clock, { tenantId: 1, entryId }, { logger });
    const r = await run(['--', '--establishment', '701', '--tenant', '1']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Linhas verificadas: 5');
    expect(r.out).toContain('Último NSR: 5');
    expect(r.out).toContain('ÍNTEGRO');
    expect(r.out).not.toContain(db.readerUrl);
  });

  it('estabelecimento vazio: exit 0', async () => {
    const r = await run(['--establishment', '702', '--tenant', '1']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Linhas verificadas: 0');
  });

  it('NSR pulado (inserido pelo arp_core, que pode dar INSERT): exit 1', async () => {
    const insert = (nsr: number) =>
      core.query(
        `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em,
                                tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
         VALUES (703, $1, 1, '7', '12345678901', '2026-11-20 12:00:00+00', '2026-11-20 12:00:01+00',
                 '01', false, $2, $3, 1)`,
        [nsr, Buffer.alloc(32, nsr), Buffer.alloc(32)],
      );
    await insert(1);
    await insert(3);
    const r = await run(['--establishment', '703', '--tenant', '1']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('NSR não contíguo');
    expect(r.out).toContain('PROBLEMAS ENCONTRADOS');
  });

  it('outra conta não enxerga a cadeia (filtra conta_id)', async () => {
    const r = await run(['--establishment', '701', '--tenant', '2']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Linhas verificadas: 0');
  });

  it('uso incorreto e configuração ausente: exit 2', async () => {
    expect((await run(['--establishment', '701'])).code).toBe(2);
    expect((await run(['--tenant', 'x', '--establishment', '1'])).code).toBe(2);
    expect((await run(['--tenant', '1', '--establishment', '1', '--foo'])).code).toBe(2);
    const noEnv = await run(['--tenant', '1', '--establishment', '1'], {});
    expect(noEnv.code).toBe(2);
    expect(noEnv.err).toContain('ARP_READER_DATABASE_URL');
  });

  it('banco inacessível: exit 2 sem vazar a URL', async () => {
    const bad = db.readerUrl.replace(/:\d+\//, ':1/');
    const r = await run(['--tenant', '1', '--establishment', '1'], { ARP_READER_DATABASE_URL: bad });
    expect(r.code).toBe(2);
    expect(r.err + r.out).not.toContain(bad);
  });
});

/**
 * LIMITAÇÃO: o banco impede criar "entrada processado sem evidência/registro/eventos"
 * (o trigger exigir_registro_para_processar barra, e registros/evidencias são imutáveis),
 * então o caso não é reproduzível sem contornar triggers. A regra pura é coberta aqui
 * com estados injetados; a consulta SQL é coberta no caminho feliz (cadeia íntegra acima).
 */
describe('evaluateInvariant (regra pura)', () => {
  it('aceita entrada completa', () => {
    expect(evaluateInvariant([{ entryId: 1, hasEvidence: true, hasRecord: true, outboxEventCount: 3 }])).toEqual([]);
  });

  it('aponta evidência, registro e eventos faltando', () => {
    const problems = evaluateInvariant([
      { entryId: 1, hasEvidence: false, hasRecord: false, outboxEventCount: 0 },
      { entryId: 2, hasEvidence: true, hasRecord: false, outboxEventCount: 3 },
      { entryId: 3, hasEvidence: true, hasRecord: true, outboxEventCount: 2 },
    ]);
    expect(problems).toEqual([
      { entryId: 1, reason: 'sem evidência' },
      { entryId: 2, reason: 'sem registro' },
      { entryId: 3, reason: 'outbox com 2 de 3 eventos' },
    ]);
  });
});
