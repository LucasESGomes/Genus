/**
 * Apoio dos testes do worker: Valkey em container, filas, worker real e captura de log.
 * Cada arquivo de teste sobe o seu Postgres (`startArpTestDatabase`) e o seu Valkey.
 */
import {
  createProducerConnection,
  createPunchesQueue,
  createWorkerConnection,
  PUNCH_JOB_NAME,
  punchJobId,
  VALKEY_IMAGE,
} from '@genus/queue';
import { createLogger, type Clock } from '@genus/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { createPostPunchPublisher, type PostPunchPublisher } from '../../src/worker/post-punch-publisher';
import { startPunchWorker, type PunchWorkerHandle } from '../../src/worker/punch-worker';
import { TickingClock } from '../support/arp-fixtures';

export interface TestValkey {
  url: string;
  stop(): Promise<void>;
}

export async function startValkey(): Promise<TestValkey> {
  const container: StartedTestContainer = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withCommand(['valkey-server', '--maxmemory-policy', 'noeviction'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    stop: async () => {
      await container.stop();
    },
  };
}

export interface LogLine {
  level: string;
  event?: string;
  msg?: string;
  [key: string]: unknown;
}

export interface CapturedLogs {
  lines: LogLine[];
  byEvent(event: string): LogLine[];
}

export function captureLogs(): { logger: ReturnType<typeof createLogger>; logs: CapturedLogs } {
  const lines: LogLine[] = [];
  const logger = createLogger({
    level: 'debug',
    service: 'rep-core-test',
    destination: {
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  });
  return { logger, logs: { lines, byEvent: (event) => lines.filter((l) => l.event === event) } };
}

export interface WorkerHarness {
  punches: Queue;
  postPunch: Queue;
  dayRecalculation: Queue;
  logs: CapturedLogs;
  /** Enfileira em `punches` como a API faria (jobId = aparelho-sequência). */
  enqueue(entry: { entryId: number; tenantId: number; establishmentId: number }, deviceId: number, sequence: number): Promise<string>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  valkeyUrl: string;
  pool: pg.Pool;
  clock?: Clock;
  attempts?: number;
  concurrency?: number;
  /** Publicador alternativo (falha injetada). Padrão: o real, sobre o Valkey do teste. */
  publisher?: PostPunchPublisher;
  /** Não sobe o worker (só as filas), para quem quer controlar o consumo. */
  startWorker?: boolean;
}

export async function startHarness(opts: HarnessOptions): Promise<WorkerHarness> {
  const attempts = opts.attempts ?? 5;
  const { logger, logs } = captureLogs();
  const cleanups: (() => Promise<void> | void)[] = [];

  const queueConn = createProducerConnection({ url: opts.valkeyUrl, password: undefined, publishTimeoutMs: 5000 });
  const punches = createPunchesQueue(queueConn, { attempts });
  const inspectConn = new Redis(opts.valkeyUrl, { maxRetriesPerRequest: null });
  const postPunch = new Queue('post-punch', { connection: inspectConn });
  const dayRecalculation = new Queue('day-recalculation', { connection: inspectConn });
  cleanups.push(
    () => punches.close(),
    () => postPunch.close(),
    () => dayRecalculation.close(),
    () => queueConn.disconnect(),
    () => inspectConn.disconnect(),
  );

  let publisher = opts.publisher;
  if (!publisher) {
    const publisherConn = createProducerConnection({ url: opts.valkeyUrl, password: undefined, publishTimeoutMs: 2000 });
    const real = createPostPunchPublisher({ connection: publisherConn, logger, timeoutMs: 2000, attempts });
    publisher = real;
    cleanups.push(() => real.close(), () => publisherConn.disconnect());
  }

  let worker: PunchWorkerHandle | undefined;
  if (opts.startWorker !== false) {
    const workerConn = createWorkerConnection({ url: opts.valkeyUrl, password: undefined });
    worker = startPunchWorker({
      pool: opts.pool,
      clock: opts.clock ?? new TickingClock(),
      logger,
      connection: workerConn,
      publisher,
      concurrency: opts.concurrency ?? 4,
      attempts,
    });
    cleanups.push(() => workerConn.disconnect());
  }

  return {
    punches,
    postPunch,
    dayRecalculation,
    logs,
    async enqueue(entry, deviceId, sequence) {
      const jobId = punchJobId(deviceId, sequence);
      await punches.add(PUNCH_JOB_NAME, entry, { jobId });
      return jobId;
    },
    async close() {
      await worker?.close();
      for (const c of cleanups) await Promise.resolve(c()).catch(() => undefined);
    },
  };
}

/** Repete `check` até devolver verdadeiro ou estourar o prazo. */
export async function waitFor(
  check: () => Promise<boolean>,
  what: string,
  timeoutMs = 30_000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Prazo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Remove jobs das filas entre testes (o nome das filas é fixo). */
export async function resetQueues(valkeyUrl: string): Promise<void> {
  const conn = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
  try {
    for (const name of ['punches', 'post-punch', 'day-recalculation']) {
      const q = new Queue(name, { connection: conn });
      await q.obliterate({ force: true });
      await q.close();
    }
  } finally {
    conn.disconnect();
  }
}
