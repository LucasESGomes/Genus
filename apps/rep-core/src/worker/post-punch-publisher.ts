/**
 * Publicador dos eventos pós-batida usado pelo worker (a fila de cada evento vem de
 * `queueNameForEvent`: `recalculate-day` em `day-recalculation`, o resto em `post-punch`),
 * DEPOIS do COMMIT do NSR e fora de qualquer transação (docs/SPEC-nsr-fila.md §2 item 4). Falha ou prazo estourado
 * só é sinalizado a quem chama, que registra `warn` e segue: o outbox continua
 * `pendente` e o resgate (apps/jobs) publica depois.
 */
import {
  createOutboxEventQueues,
  postPunchJobId,
  type PostPunchEvent,
  type PostPunchJobData,
} from '@genus/queue';
import type { Logger } from '@genus/shared';
import type { Redis } from 'ioredis';

export interface PostPunchPublisher {
  /** Lança em falha ou prazo estourado. O `jobId` determinístico torna a republicação idempotente. */
  publish(event: PostPunchEvent, data: PostPunchJobData): Promise<void>;
  close(): Promise<void>;
}

export interface PostPunchPublisherOptions {
  /** Conexão de `createProducerConnection` (sem fila offline). */
  connection: Redis;
  logger: Logger;
  timeoutMs: number;
  attempts?: number;
}

class PublishTimeoutError extends Error {
  override readonly name = 'QueuePublishTimeoutError';
  constructor() {
    super('Prazo de publicação esgotado');
  }
}

async function withDeadline<T>(timeoutMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PublishTimeoutError());
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

/** Sem fila offline, comando em conexão que ainda não está pronta falha: espera o `ready` dentro do prazo. */
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
      reject(new PublishTimeoutError());
    };
    connection.once('ready', onReady);
    signal.addEventListener('abort', onAbort, { once: true });
    if (connection.status === 'wait' || connection.status === 'end') {
      connection.connect().catch(() => undefined);
    }
  });
}

const ERROR_LOG_THROTTLE_MS = 30_000;

export function createPostPunchPublisher(opts: PostPunchPublisherOptions): PostPunchPublisher {
  const { connection, logger, timeoutMs } = opts;
  const queues = createOutboxEventQueues(connection, { attempts: opts.attempts });

  // Sem ouvinte, erro de conexão derruba o processo. Loga só nome/código (nunca URL), no máximo a cada 30 s.
  let lastErrorLogAt = Number.NEGATIVE_INFINITY;
  const onError = (err: Error & { code?: string }) => {
    const now = performance.now();
    if (now - lastErrorLogAt < ERROR_LOG_THROTTLE_MS) return;
    lastErrorLogAt = now;
    logger.warn(
      { event: 'queue_connection_error', err: { name: err.name, code: err.code ?? null } },
      'fila: erro de conexão com o Valkey (publicação)',
    );
  };
  connection.on('error', onError);
  for (const queue of queues.all) queue.on('error', onError);

  return {
    async publish(event, data) {
      const jobId = postPunchJobId(event, data.establishmentId, data.nsr);
      await withDeadline(timeoutMs, async (signal) => {
        await waitUntilReady(connection, signal);
        // O nome do job é o evento; o payload só tem IDs.
        await queues.forEvent(event).add(event, data, { jobId });
      });
    },

    async close() {
      connection.off('error', onError);
      connection.on('error', () => undefined);
      for (const queue of queues.all) queue.on('error', () => undefined);
      try {
        await withDeadline(2000, () => Promise.all(queues.all.map((queue) => queue.close())));
      } catch {
        // a conexão é derrubada pelo dono
      }
    },
  };
}
