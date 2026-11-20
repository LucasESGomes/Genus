/**
 * Publicador da fila `punches` para a API do coletor.
 *
 * A publicação vem DEPOIS do COMMIT da entrada e FORA de qualquer transação:
 * a batida já está salva e nunca é desfeita por falha aqui. Por isso o prazo
 * é curto e a falha só é sinalizada a quem chama (que registra um `warn` e
 * segue). O resgate (apps/jobs) cobre o que não chegou à fila.
 */
import type { Logger, PunchQueueEntry, QueuePublisher } from '@genus/shared';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { PUNCH_JOB_NAME } from './constants.js';
import { punchJobId } from './job-ids.js';
import { punchPayloadSchema, type PunchJobData } from './payloads.js';
import { createPunchesQueue } from './queues.js';

export interface QueuePublisherOptions {
  /** Conexão de `createProducerConnection` (sem fila offline). */
  connection: Redis;
  logger: Logger;
  /** Prazo total de `publishPunch` e de `ping`. Padrão 250 ms. */
  timeoutMs?: number;
  attempts?: number;
}

export interface ClosableQueuePublisher extends QueuePublisher {
  /** A fila de `punches` já criada, para resgate/inspeção que compartilhe a conexão. */
  readonly queue: Queue<PunchJobData>;
  close(): Promise<void>;
}

const ERROR_LOG_THROTTLE_MS = 30_000;

class TimeoutError extends Error {
  override readonly name = 'QueueTimeoutError';
  constructor() {
    super('Prazo da fila esgotado');
  }
}

/** Corre `work` contra um prazo; limpa o timer e não deixa rejeição solta. */
async function withDeadline<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, timeoutMs);
  });
  const pending = work(controller.signal);
  // Se o prazo vencer primeiro, a promessa original ainda pode rejeitar depois.
  pending.catch(() => undefined);
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sem fila offline, comando em conexão que ainda não está pronta falha: espera o `ready` (dentro do prazo). */
function waitUntilReady(connection: Redis, signal: AbortSignal): Promise<void> {
  if (connection.status === 'ready') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      connection.off('ready', onReady);
      signal.removeEventListener('abort', onAbort);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new TimeoutError());
    };
    connection.once('ready', onReady);
    signal.addEventListener('abort', onAbort, { once: true });
    if (connection.status === 'wait' || connection.status === 'end') {
      connection.connect().catch(() => undefined);
    }
  });
}

export function createQueuePublisher(opts: QueuePublisherOptions): ClosableQueuePublisher {
  const { connection, logger } = opts;
  const timeoutMs = opts.timeoutMs ?? 250;
  const queue = createPunchesQueue(connection, { attempts: opts.attempts });

  // Sem listener, um erro de conexão do ioredis/BullMQ derrubaria o processo.
  // Loga só o nome/código (nunca a URL nem a mensagem, que pode citar host) e no máximo a cada 30 s.
  let lastErrorLogAt = Number.NEGATIVE_INFINITY;
  const onError = (err: Error & { code?: string }) => {
    const now = performance.now();
    if (now - lastErrorLogAt < ERROR_LOG_THROTTLE_MS) return;
    lastErrorLogAt = now;
    logger.warn({ event: 'queue_connection_error', err: { name: err.name, code: err.code ?? null } }, 'fila: erro de conexão com o Valkey');
  };
  connection.on('error', onError);
  queue.on('error', onError);

  return {
    queue,

    async publishPunch(entry: PunchQueueEntry): Promise<void> {
      // `parse` descarta deviceId/deviceSequence do payload: eles só montam o jobId.
      const payload = punchPayloadSchema.parse({
        entryId: entry.entryId,
        tenantId: entry.tenantId,
        establishmentId: entry.establishmentId,
      });
      const jobId = punchJobId(entry.deviceId, entry.deviceSequence);
      await withDeadline(timeoutMs, async (signal) => {
        await waitUntilReady(connection, signal);
        await queue.add(PUNCH_JOB_NAME, payload, { jobId });
      });
    },

    async ping(): Promise<boolean> {
      try {
        await withDeadline(timeoutMs, async (signal) => {
          await waitUntilReady(connection, signal);
          await connection.ping();
        });
        return true;
      } catch {
        return false;
      }
    },

    async close(): Promise<void> {
      connection.off('error', onError);
      // Mantém um listener mudo até fechar, para um erro tardio não derrubar o processo.
      connection.on('error', () => undefined);
      queue.on('error', () => undefined);
      try {
        await withDeadline(2000, () => queue.close());
      } catch {
        // fecha à força abaixo
      }
      connection.disconnect();
    },
  };
}
