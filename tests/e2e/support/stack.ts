/**
 * Peças do fluxo real, montadas como em produção: API do coletor (buildApp + container
 * reais, publicador real da `@genus/queue`), worker do rep-core, resgate do `apps/jobs`.
 *
 * `apps/collector-api`, `apps/rep-core` e `apps/jobs` não expõem `exports` no package.json;
 * por isso os módulos vêm por caminho relativo ao fonte (somente leitura, sem alterar nada).
 */
import {
  createPostPunchQueue,
  createProducerConnection,
  createPunchesQueue,
  createWorkerConnection,
  PUNCH_JOB_NAME,
  type PostPunchJobData,
  type PunchJobData,
} from '@genus/queue';
import { createLogger, FixedClock, type Clock, type Logger } from '@genus/shared';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { buildApp } from '../../../apps/collector-api/src/app';
import { loadEnv } from '../../../apps/collector-api/src/config/env';
import { createContainer } from '../../../apps/collector-api/src/container';
import { multipartBody, SERVICE_KEY, SERVER_NOW } from '../../../apps/collector-api/test/support/harness';
import { runRescueOnce, type RescueResult } from '../../../apps/jobs/src/rescue';
import { createPostPunchPublisher } from '../../../apps/rep-core/src/worker/post-punch-publisher';
import { startPunchWorker } from '../../../apps/rep-core/src/worker/punch-worker';
import { ENGINE_API_KEY, MASTER_KEY, waitReady, type Infra } from './infra';

export { SERVER_NOW };

export interface LogLine {
  level: string;
  event?: string;
  [key: string]: unknown;
}

export interface CapturedLogs {
  logger: Logger;
  lines: LogLine[];
  byEvent(event: string): LogLine[];
}

export function captureLogs(service: string): CapturedLogs {
  const lines: LogLine[] = [];
  const logger = createLogger({
    level: 'debug',
    service,
    destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk) as LogLine) },
  });
  return { logger, lines, byEvent: (event) => lines.filter((l) => l.event === event) };
}

/** Relógio que avança 1 ms a cada leitura (gravado_em distinto e monotônico no worker). */
export class TickingClock implements Clock {
  private ticks = 0;
  constructor(private readonly base: number = Date.UTC(2026, 10, 20, 13, 0, 0)) {}
  now(): Date {
    return new Date(this.base + this.ticks++);
  }
}

export interface Disposer {
  add(fn: () => Promise<void> | void): void;
  run(): Promise<void>;
}

export function disposer(): Disposer {
  const fns: (() => Promise<void> | void)[] = [];
  return {
    add: (fn) => void fns.push(fn),
    run: async () => {
      for (const fn of fns.splice(0).reverse()) await Promise.resolve(fn()).catch(() => undefined);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// API do coletor

export interface Collector {
  app: Awaited<ReturnType<typeof buildApp>>;
  logs: CapturedLogs;
  clock: FixedClock;
  establishmentId: number;
  deviceId: number;
  close(): Promise<void>;
}

export interface CollectorOptions {
  establishmentId: number;
  deviceId: number;
  tenantId?: number;
  /** `QUEUE_ATTEMPTS` da API (vira `opts.attempts` dos jobs de `punches`). */
  attempts?: number;
  /** Padrão: o Valkey do ambiente. Passe a URL de um `ToggleProxy` para simular Valkey fora. */
  valkeyUrl?: string;
  /** Padrão: o papel `arp_collector` do ambiente. */
  databaseUrl?: string;
}

export async function startCollector(infra: Infra, opts: CollectorOptions): Promise<Collector> {
  const env = loadEnv({
    APP_ENV: 'dev',
    LOG_LEVEL: 'debug',
    ARP_DATABASE_URL: opts.databaseUrl ?? infra.db.collectorUrl,
    ENGINE_URL: infra.engine.url,
    ENGINE_API_KEY,
    MASTER_KEY,
    ENGINE_TIMEOUT_MS: '2000',
    COLLECTOR_SERVICE_KEYS: SERVICE_KEY,
    FAKE_CANDIDATES_ENABLED: 'true',
    FAKE_CANDIDATES_COUNT: '20',
    DEV_TENANT_ID: String(opts.tenantId ?? 1),
    DEV_ESTABLISHMENT_ID: String(opts.establishmentId),
    DEV_DEVICE_ID: String(opts.deviceId),
    VALKEY_URL: opts.valkeyUrl ?? infra.valkey.url,
    QUEUE_PUBLISH_TIMEOUT_MS: '250',
    QUEUE_ATTEMPTS: String(opts.attempts ?? 5),
  });
  const logs = captureLogs('collector-api');
  const clock = new FixedClock(SERVER_NOW);
  const container = createContainer(env, { logger: logs.logger, clock });
  const app = await buildApp(container.appDeps);
  return {
    app,
    logs,
    clock,
    establishmentId: opts.establishmentId,
    deviceId: opts.deviceId,
    close: async () => {
      await app.close();
      await container.close();
    },
  };
}

/** POST /coletor/batidas multipart, como o aparelho faz. `capturedAt` padrão: SERVER_NOW. */
export async function postPunch(c: Collector, deviceSequence: number, capturedAt?: string) {
  const { payload, headers } = await multipartBody({ deviceSequence, capturedAt });
  return c.app.inject({
    method: 'POST',
    url: '/coletor/batidas',
    payload,
    headers: { ...headers, 'x-service-key': SERVICE_KEY },
  });
}

// ---------------------------------------------------------------------------------------------
// Filas (inspeção e resgate)

export interface Queues {
  punches: Queue<PunchJobData>;
  postPunch: Queue<PostPunchJobData>;
  connection: Redis;
  close(): Promise<void>;
}

export async function openQueues(valkeyUrl: string, attempts?: number): Promise<Queues> {
  const connection = createProducerConnection({ url: valkeyUrl, password: undefined, publishTimeoutMs: 5000 });
  connection.on('error', () => undefined);
  await waitReady(connection);
  const punches = createPunchesQueue(connection, { attempts });
  const postPunch = createPostPunchQueue(connection, { attempts });
  punches.on('error', () => undefined);
  postPunch.on('error', () => undefined);
  return {
    punches,
    postPunch,
    connection,
    close: async () => {
      await punches.close().catch(() => undefined);
      await postPunch.close().catch(() => undefined);
      connection.disconnect();
    },
  };
}

export async function totalJobs(queue: Queue): Promise<number> {
  const counts = await queue.getJobCounts();
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/** Enfileira em `punches` como a API faria (jobId = aparelho-sequência). */
export async function enqueuePunch(queues: Queues, data: PunchJobData, jobId: string): Promise<void> {
  await queues.punches.add(PUNCH_JOB_NAME, data, { jobId });
}

export interface RescueHandle {
  run(clock: Clock): Promise<RescueResult>;
  logs: CapturedLogs;
}

/** Uma rodada do resgate do `apps/jobs` com `arp_reader` e o relógio dado. */
export function rescueRunner(infra: Infra, queues: Queues): RescueHandle {
  const logs = captureLogs('jobs');
  return {
    logs,
    run: (clock) =>
      runRescueOnce({
        reader: infra.reader,
        clock,
        logger: logs.logger,
        punchesQueue: queues.punches,
        postPunchQueue: queues.postPunch,
        minAgeMs: 30_000,
        postPunchDepthWarn: 10_000,
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// Worker do rep-core

export interface RepCore {
  logs: CapturedLogs;
  close(): Promise<void>;
}

export interface RepCoreOptions {
  attempts?: number;
  concurrency?: number;
  clock?: Clock;
  /** URL do Valkey usada SÓ pelo publicador de `post-punch` (padrão: o Valkey do ambiente). */
  postPunchUrl?: string;
}

export function startRepCore(infra: Infra, opts: RepCoreOptions = {}): RepCore {
  const attempts = opts.attempts ?? 5;
  const logs = captureLogs('rep-core');
  const workerConnection = createWorkerConnection({ url: infra.valkey.url, password: undefined });
  workerConnection.on('error', () => undefined);
  const producerConnection = createProducerConnection({
    url: opts.postPunchUrl ?? infra.valkey.url,
    password: undefined,
    publishTimeoutMs: 2000,
  });
  producerConnection.on('error', () => undefined);
  const publisher = createPostPunchPublisher({
    connection: producerConnection,
    logger: logs.logger,
    timeoutMs: 1500,
    attempts,
  });
  const worker = startPunchWorker({
    pool: infra.core,
    clock: opts.clock ?? new TickingClock(),
    logger: logs.logger,
    connection: workerConnection,
    publisher,
    concurrency: opts.concurrency ?? 4,
    attempts,
  });
  return {
    logs,
    close: async () => {
      await worker.close();
      await publisher.close();
      producerConnection.disconnect();
      workerConnection.disconnect();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Falhas injetadas no banco (como `arp_owner`; só em banco de teste)

export async function installOutboxFailure(owner: pg.Pool): Promise<void> {
  await owner.query(`
    CREATE OR REPLACE FUNCTION e2e_falhar_outbox() RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.evento = 'recalculate-day' THEN
        RAISE EXCEPTION 'falha injetada no outbox (teste e2e)';
      END IF;
      RETURN NEW;
    END $fn$`);
  await owner.query(
    `CREATE TRIGGER trg_e2e_falhar_outbox BEFORE INSERT ON outbox
       FOR EACH ROW EXECUTE FUNCTION e2e_falhar_outbox()`,
  );
}

export async function removeOutboxFailure(owner: pg.Pool): Promise<void> {
  await owner.query('DROP TRIGGER IF EXISTS trg_e2e_falhar_outbox ON outbox');
  await owner.query('DROP FUNCTION IF EXISTS e2e_falhar_outbox()');
}
