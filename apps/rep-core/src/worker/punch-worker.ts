/**
 * Worker da fila `punches` (docs/SPEC-nsr-fila.md §2 e §7).
 *
 * Ordem de sucesso, que este arquivo preserva:
 *   1. `assignNsr` faz a transação inteira (registro, evidência, sequência, 3 eventos
 *      de outbox e `entradas.status`) e só devolve depois do COMMIT.
 *   2. Só então publica os 3 eventos em `post-punch`, fora de transação. Falha ou prazo
 *      estourado vira `warn` e NÃO falha o job: o outbox segue `pendente` e o resgate
 *      (apps/jobs) publica depois. Nunca se publica evento cujo COMMIT não aconteceu.
 *   3. Só depois disso o job termina com sucesso.
 *
 * Portaria 671: nada aqui bloqueia, edita ou apaga marcação. Os UPDATEs de erro mexem
 * apenas em `status` e `tentativas` de `entradas` (colunas que o papel `arp_core` pode alterar).
 */
import { punchPayloadSchema, PUNCHES_QUEUE, type PostPunchJobData } from '@genus/queue';
import { roundMs, startTimer, type Clock, type Logger } from '@genus/shared';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { assignNsr, type AssignNsrResult } from '../nsr/assign-nsr.js';
import { AssignNsrError, EntryFailedError, isRecoverable } from '../nsr/errors.js';
import type { PostPunchPublisher } from './post-punch-publisher.js';

export interface PunchWorkerDeps {
  pool: Pool;
  clock: Clock;
  logger: Logger;
  /** Conexão de `createWorkerConnection` (`maxRetriesPerRequest: null`). */
  connection: Redis;
  publisher: PostPunchPublisher;
  /** `WORKER_CONCURRENCY`. O `Pool` precisa de pelo menos isso + folga. */
  concurrency: number;
  /** `QUEUE_ATTEMPTS`: usado só se o job não trouxer `opts.attempts`. */
  attempts: number;
}

export interface PunchWorkerHandle {
  /** Para de consumir, espera os jobs ativos terminarem e fecha o worker (não fecha pool nem conexões). */
  close(): Promise<void>;
}

/** Só nome e código (nunca a mensagem de erro de driver, que pode citar host ou SQL). */
function describeError(err: unknown): { name: string; code: string | null; message?: string } {
  if (err instanceof AssignNsrError) {
    // Mensagens de domínio só carregam ids.
    return { name: err.name, code: null, message: err.message };
  }
  const code = (err as { code?: unknown } | null)?.code;
  return {
    name: err instanceof Error ? err.name : 'unknown',
    code: typeof code === 'string' ? code : null,
  };
}

/**
 * Soma uma tentativa em `entradas` em statement SEPARADO: a transação do NSR já deu
 * rollback. Nunca lança: se o UPDATE falhar, só registra.
 * Erro recuperável NUNCA marca `falhou` (decisão: a batida já foi confirmada ao aparelho
 * e não pode sumir do registro por uma queda temporária). A entrada segue `pendente` e
 * o resgate reenfileira. `status = 'pendente'` no WHERE: `processado` é terminal.
 */
async function recordAttemptFailure(deps: PunchWorkerDeps, tenantId: number, entryId: number): Promise<void> {
  try {
    await deps.pool.query(
      `UPDATE entradas
          SET tentativas = tentativas + 1
        WHERE id = $1 AND conta_id = $2 AND status = 'pendente'`,
      [entryId, tenantId],
    );
  } catch (updateErr) {
    deps.logger.warn(
      { event: 'punch_attempt_update_failed', entryId, err: describeError(updateErr) },
      'rep-core: não foi possível registrar a tentativa em entradas',
    );
  }
}

/** Erro não recuperável: marca `falhou` já (se a entrada ainda for `pendente`). Nunca lança. */
async function markEntryFailed(deps: PunchWorkerDeps, tenantId: number, entryId: number): Promise<void> {
  try {
    await deps.pool.query(
      `UPDATE entradas SET status = 'falhou'
        WHERE id = $1 AND conta_id = $2 AND status = 'pendente'`,
      [entryId, tenantId],
    );
  } catch (updateErr) {
    deps.logger.warn(
      { event: 'punch_mark_failed_update_failed', entryId, err: describeError(updateErr) },
      'rep-core: não foi possível marcar a entrada como falhou',
    );
  }
}

/** Publica os 3 eventos; cada falha vira `warn` e o conjunto nunca lança. */
async function publishEvents(deps: PunchWorkerDeps, result: AssignNsrResult): Promise<number> {
  const settled = await Promise.allSettled(
    result.outboxEvents.map((ref) => {
      const data: PostPunchJobData = {
        outboxId: ref.outboxId,
        tenantId: result.tenantId,
        establishmentId: result.establishmentId,
        nsr: result.nsr,
      };
      return deps.publisher.publish(ref.evento, data);
    }),
  );
  let failures = 0;
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') return;
    failures += 1;
    const ref = result.outboxEvents[i];
    deps.logger.warn(
      {
        event: 'queue_publish_failed',
        queue: 'post-punch',
        outboxEvent: ref?.evento,
        outboxId: ref?.outboxId,
        establishmentId: result.establishmentId,
        nsr: result.nsr,
        err: describeError(outcome.reason),
      },
      'fila: falha ao publicar em post-punch; o resgate publica depois',
    );
  });
  return failures;
}

/** Processador de um job de `punches`. Exportado para testes; produção usa `startPunchWorker`. */
export function createPunchProcessor(deps: PunchWorkerDeps): (job: Job) => Promise<void> {
  const { logger } = deps;

  return async function processPunch(job: Job): Promise<void> {
    const parsed = punchPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      // Sem entryId confiável não há o que marcar. Só campos do schema, nunca o payload cru.
      logger.error(
        { event: 'punch_payload_invalid', jobId: job.id ?? null, fields: parsed.error.issues.map((i) => i.path.join('.')) },
        'rep-core: payload de job inválido',
      );
      throw new UnrecoverableError('payload inválido');
    }
    const { entryId, tenantId } = parsed.data;
    const elapsed = startTimer();

    let result: AssignNsrResult;
    try {
      result = await assignNsr(deps.pool, deps.clock, { tenantId, entryId }, { logger });
    } catch (err) {
      if (err instanceof EntryFailedError) {
        // A entrada já está `falhou`: reprocessar não adianta. Termina o job sem erro.
        logger.warn({ event: 'punch_entry_failed_skipped', entryId }, 'rep-core: entrada já marcada como falhou; ignorada');
        return;
      }

      if (!isRecoverable(err)) {
        await markEntryFailed(deps, tenantId, entryId);
        logger.error(
          { event: 'punch_unrecoverable', entryId, jobId: job.id ?? null, err: describeError(err) },
          'rep-core: erro não recuperável; o job não será repetido',
        );
        throw new UnrecoverableError(err instanceof Error ? err.name : 'erro não recuperável');
      }

      const maxAttempts = job.opts.attempts ?? deps.attempts;
      // `attemptsMade` conta as tentativas já falhadas; esta é a (attemptsMade + 1)-ésima.
      const exhausted = job.attemptsMade + 1 >= maxAttempts;
      await recordAttemptFailure(deps, tenantId, entryId);
      if (exhausted) {
        // Alerta, não falha: a entrada segue pendente e o resgate continua tentando.
        logger.error(
          {
            event: 'punch_retry_exhausted',
            entryId,
            jobId: job.id ?? null,
            attempts: job.attemptsMade + 1,
            err: describeError(err),
          },
          'rep-core: tentativas automáticas esgotadas; entrada segue pendente para o resgate',
        );
      } else {
        logger.warn(
          { event: 'punch_retry', entryId, attempt: job.attemptsMade + 1, maxAttempts, err: describeError(err) },
          'rep-core: erro recuperável; a fila fará nova tentativa',
        );
      }
      throw err;
    }

    // COMMIT feito. Daqui em diante nada pode falhar o job.
    const publishFailures = await publishEvents(deps, result);

    logger.info(
      {
        event: 'punch_processed',
        entryId,
        establishmentId: result.establishmentId,
        nsr: result.nsr,
        outcome: result.outcome,
        publishFailures,
        lockWaitMs: result.timings.lockWaitMs,
        txMs: result.timings.txMs,
        totalMs: roundMs(elapsed()),
      },
      'rep-core: batida processada',
    );
  };
}

export function startPunchWorker(deps: PunchWorkerDeps): PunchWorkerHandle {
  const worker = new Worker(PUNCHES_QUEUE, createPunchProcessor(deps), {
    connection: deps.connection,
    concurrency: deps.concurrency,
  });

  // Sem ouvinte, erro do Worker derruba o processo. Só nome/código no log.
  worker.on('error', (err: Error & { code?: string }) => {
    deps.logger.warn(
      { event: 'worker_error', err: { name: err.name, code: err.code ?? null } },
      'rep-core: erro no worker da fila',
    );
  });

  return {
    async close() {
      // `close()` sem `force` espera os jobs ativos terminarem.
      await worker.close();
    },
  };
}
