/**
 * Resgate (docs/SPEC-nsr-fila.md §8): republica o que ficou `pendente` no banco e não
 * chegou à fila (ou ficou preso nela). O banco é a fonte da verdade; a fila só transporta.
 *
 * - Lê com `arp_reader` e NUNCA escreve no banco. Quem muda `status` é o rep-core.
 * - EXCEÇÃO ao "toda query filtra por conta_id": este é um processo de infraestrutura e
 *   varre todas as contas. Por isso cada job carrega o `conta_id` da linha no payload
 *   (`tenantId`), e o rep-core volta a filtrar por ele ao processar.
 * - "Agora" vem do `Clock` injetado, não do `now()` do SQL.
 * - Tudo usa o MESMO `jobId` da publicação normal (`punchJobId` / `postPunchJobId`), então
 *   republicar é idempotente.
 * - `recalculate-day` tem regra própria: o outbox não vira `processado` (só o rep-core escreve
 *   no `arp`), então a marca de processado é o job `completed`, guardado por 48 h em
 *   `day-recalculation`. Só entram linhas entre `minAgeMs` e 1 h de idade, e job concluído
 *   não é republicado. Job que falha por mais de 1 h fica `failed` (recálculo manual).
 */
import {
  postPunchJobId,
  postPunchPayloadSchema,
  POST_PUNCH_EVENTS,
  PUNCH_JOB_NAME,
  punchJobId,
  punchPayloadSchema,
  RECALCULATE_DAY_EVENT,
  type PostPunchJobData,
  type PunchJobData,
} from '@genus/queue';
import type { Clock, Logger } from '@genus/shared';
import type { Queue } from 'bullmq';
import type { Pool } from 'pg';

export const RESCUE_BATCH_SIZE = 500;
/** Idade máxima de um `recalculate-day` republicado. Menor que a retenção do job concluído (48 h). */
export const RECALCULATE_RESCUE_MAX_AGE_MS = 60 * 60 * 1000;
/** Trava de segurança contra varredura sem fim num único ciclo (500 x 200 = 100 mil linhas). */
const MAX_BATCHES_PER_KIND = 200;
/** Itens verificados em paralelo dentro de um lote (cada um faz poucos comandos ao Valkey). */
const ITEM_CONCURRENCY = 25;

export interface RescueDeps {
  /** Pool com o papel `arp_reader` (somente leitura). */
  reader: Pool;
  clock: Clock;
  logger: Logger;
  punchesQueue: Queue<PunchJobData>;
  postPunchQueue: Queue<PostPunchJobData>;
  dayRecalculationQueue: Queue<PostPunchJobData>;
  minAgeMs: number;
  postPunchDepthWarn: number;
}

export interface RescueResult {
  entradasReenfileiradas: number;
  outboxReenfileirados: number;
  ignorados: number;
  /** Lotes de até 500 lidos (entradas + outbox). */
  lotes: number;
}

type EnsureOutcome = 'enqueued' | 'skipped';

interface EntryRow {
  id: string;
  conta_id: string;
  estabelecimento_id: string;
  aparelho_id: string;
  sequencia_aparelho: string;
}

interface OutboxRow {
  id: string;
  conta_id: string;
  estabelecimento_id: string;
  evento: string;
  chave: string;
}

function toSafeInt(value: string): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Garante que existe um job vivo para `jobId`:
 * inexistente -> add; waiting/active/delayed -> nada; failed -> retry;
 * completed (com a linha ainda pendente) -> conforme `onCompleted`: remove e add, ou nada
 * (quando o job concluído é a marca de processado).
 */
async function ensureJob<T>(
  queue: Queue<T>,
  name: string,
  data: T,
  jobId: string,
  onCompleted: 'republish' | 'keep' = 'republish',
): Promise<EnsureOutcome> {
  const existing = await queue.getJob(jobId);
  if (!existing) {
    await queue.add(name as never, data as never, { jobId });
    return 'enqueued';
  }
  const state = await existing.getState();
  switch (state) {
    case 'failed':
      // resetAttemptsMade: sem isso, o job esgotado mantém attemptsMade no teto e o primeiro
      // erro recuperável já marcaria a entrada como falhou, sem nenhum retry com backoff.
      await existing.retry('failed', { resetAttemptsMade: true });
      return 'enqueued';
    case 'completed':
      if (onCompleted === 'keep') return 'skipped';
      // A linha segue `pendente` (senão nem teria sido selecionada): o job concluiu sem efeito.
      await existing.remove();
      await queue.add(name as never, data as never, { jobId });
      return 'enqueued';
    case 'unknown':
      // Sumiu entre o getJob e o getState.
      await queue.add(name as never, data as never, { jobId });
      return 'enqueued';
    default:
      // waiting, active, delayed, prioritized, waiting-children: já está na fila.
      return 'skipped';
  }
}

async function inChunks<T>(items: readonly T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function rescueEntries(
  deps: RescueDeps,
  cutoff: Date,
  result: RescueResult,
): Promise<void> {
  let lastId = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_KIND; batch++) {
    // Paginação por `id` (keyset): sem ela, um lote de 500 já enfileirado esconderia o resto.
    const res = await deps.reader.query<EntryRow>(
      `SELECT id, conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho
         FROM entradas
        WHERE status = 'pendente' AND recebido_em < $1::timestamptz AND id > $2
        ORDER BY id
        LIMIT $3`,
      [cutoff.toISOString(), lastId, RESCUE_BATCH_SIZE],
    );
    if (res.rows.length === 0) return;
    result.lotes += 1;
    await inChunks(res.rows, ITEM_CONCURRENCY, async (row) => {
      const entryId = toSafeInt(row.id);
      const tenantId = toSafeInt(row.conta_id);
      const establishmentId = toSafeInt(row.estabelecimento_id);
      const deviceId = toSafeInt(row.aparelho_id);
      const deviceSequence = toSafeInt(row.sequencia_aparelho);
      if (
        entryId === null || tenantId === null || establishmentId === null ||
        deviceId === null || deviceSequence === null
      ) {
        result.ignorados += 1;
        deps.logger.warn({ event: 'rescue_invalid_entry', entryId: row.id }, 'resgate: entrada com id fora do intervalo seguro');
        return;
      }
      const payload = punchPayloadSchema.parse({ entryId, tenantId, establishmentId });
      const outcome = await ensureJob(
        deps.punchesQueue,
        PUNCH_JOB_NAME,
        payload,
        punchJobId(deviceId, deviceSequence),
      );
      if (outcome === 'enqueued') result.entradasReenfileiradas += 1;
      else result.ignorados += 1;
    });
    const lastParsed = toSafeInt(res.rows[res.rows.length - 1]!.id);
    if (lastParsed === null) throw new Error("id fora do intervalo seguro no resgate");
    lastId = lastParsed;
    if (res.rows.length < RESCUE_BATCH_SIZE) return;
  }
  deps.logger.warn({ event: 'rescue_batch_cap_reached', kind: 'entradas' }, 'resgate: limite de lotes do ciclo atingido; o resto fica para a próxima rodada');
}

/** `chave` é `<estabelecimento_id>-<nsr>`. Devolve o nsr ou null se o formato não bater. */
export function parseOutboxKey(chave: string, establishmentId: number): number | null {
  const match = /^(\d+)-(\d+)$/.exec(chave);
  if (!match) return null;
  const keyEstablishment = Number(match[1]);
  const nsr = Number(match[2]);
  if (!Number.isSafeInteger(keyEstablishment) || !Number.isSafeInteger(nsr)) return null;
  if (keyEstablishment !== establishmentId || nsr <= 0) return null;
  return nsr;
}

/** Qual parte do outbox varrer, para onde publicar e o que fazer com job concluído. */
interface OutboxScan {
  kind: 'outbox' | 'recalculate-day';
  /** Condição sobre `evento` e idade; os parâmetros dela começam em `$4`. */
  condition: string;
  params: string[];
  queue: Queue<PostPunchJobData>;
  onCompleted: 'republish' | 'keep';
}

async function rescueOutbox(deps: RescueDeps, scan: OutboxScan, cutoff: Date, result: RescueResult): Promise<void> {
  let lastId = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_KIND; batch++) {
    const res = await deps.reader.query<OutboxRow>(
      `SELECT id, conta_id, estabelecimento_id, evento, chave
         FROM outbox
        WHERE status = 'pendente' AND criado_em < $1::timestamptz AND id > $2 AND ${scan.condition}
        ORDER BY id
        LIMIT $3`,
      [cutoff.toISOString(), lastId, RESCUE_BATCH_SIZE, ...scan.params],
    );
    if (res.rows.length === 0) return;
    result.lotes += 1;
    await inChunks(res.rows, ITEM_CONCURRENCY, async (row) => {
      const outboxId = toSafeInt(row.id);
      const tenantId = toSafeInt(row.conta_id);
      const establishmentId = toSafeInt(row.estabelecimento_id);
      const nsr = establishmentId === null ? null : parseOutboxKey(row.chave, establishmentId);
      const knownEvent = (POST_PUNCH_EVENTS as readonly string[]).includes(row.evento);
      if (outboxId === null || tenantId === null || establishmentId === null || nsr === null || !knownEvent) {
        result.ignorados += 1;
        deps.logger.warn({ event: 'rescue_invalid_outbox', outboxId: row.id }, 'resgate: linha de outbox inválida; ignorada');
        return;
      }
      const payload = postPunchPayloadSchema.parse({ outboxId, tenantId, establishmentId, nsr });
      const outcome = await ensureJob(
        scan.queue,
        row.evento,
        payload,
        postPunchJobId(row.evento, establishmentId, nsr),
        scan.onCompleted,
      );
      if (outcome === 'enqueued') result.outboxReenfileirados += 1;
      else result.ignorados += 1;
    });
    const lastParsed = toSafeInt(res.rows[res.rows.length - 1]!.id);
    if (lastParsed === null) throw new Error("id fora do intervalo seguro no resgate");
    lastId = lastParsed;
    if (res.rows.length < RESCUE_BATCH_SIZE) return;
  }
  deps.logger.warn({ event: 'rescue_batch_cap_reached', kind: scan.kind }, 'resgate: limite de lotes do ciclo atingido; o resto fica para a próxima rodada');
}

/**
 * Uma rodada de resgate: varre `entradas` e `outbox` pendentes há mais de `minAgeMs`
 * (`recalculate-day`: só até 1 h de idade), em lotes de 500 (mais antigos primeiro), e
 * republica o que não tem job vivo.
 */
export async function runRescueOnce(deps: RescueDeps): Promise<RescueResult> {
  const cutoff = new Date(deps.clock.now().getTime() - deps.minAgeMs);
  const result: RescueResult = { entradasReenfileiradas: 0, outboxReenfileirados: 0, ignorados: 0, lotes: 0 };

  await rescueEntries(deps, cutoff, result);
  await rescueOutbox(
    deps,
    { kind: 'outbox', condition: 'evento <> $4', params: [RECALCULATE_DAY_EVENT], queue: deps.postPunchQueue, onCompleted: 'republish' },
    cutoff,
    result,
  );
  const oldest = new Date(deps.clock.now().getTime() - RECALCULATE_RESCUE_MAX_AGE_MS);
  await rescueOutbox(
    deps,
    {
      kind: 'recalculate-day',
      condition: 'evento = $4 AND criado_em >= $5::timestamptz',
      params: [RECALCULATE_DAY_EVENT, oldest.toISOString()],
      queue: deps.dayRecalculationQueue,
      onCompleted: 'keep',
    },
    cutoff,
    result,
  );

  const counts = await deps.postPunchQueue.getJobCounts('waiting', 'delayed', 'active');
  const depth = (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
  if (depth > deps.postPunchDepthWarn) {
    deps.logger.warn(
      { event: 'post_punch_depth_high', depth, threshold: deps.postPunchDepthWarn },
      'resgate: fila post-punch acima do limite (sem consumidor ou consumidor lento)',
    );
  }

  deps.logger.info(
    {
      event: 'rescue_round',
      entradas_reenfileiradas: result.entradasReenfileiradas,
      outbox_reenfileirados: result.outboxReenfileirados,
      ignorados: result.ignorados,
      lotes: result.lotes,
    },
    'resgate: rodada concluída',
  );
  return result;
}
