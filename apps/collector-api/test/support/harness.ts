/**
 * Utilitários dos testes de integração da rota: app real (container + buildApp)
 * contra Postgres real e o stub HTTP da engine.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createLogger, FixedClock, type Logger } from '@genus/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { createContainer, type Container } from '../../src/container';

export const ENGINE_API_KEY = 'chave-da-engine-de-teste-0123456789';
export const MASTER_KEY = randomBytes(32).toString('hex');
export const SERVICE_KEY = 'chave-de-servico-atual-0123456789abcdef';
export const SERVICE_KEY_NEW = 'chave-de-servico-nova-0123456789abcdef';
export const SERVER_NOW = '2026-11-18T12:00:00.000Z';

export interface MemoryLog {
  lines: string[];
  records(): Record<string, unknown>[];
  text(): string;
  clear(): void;
}

export function memoryLog(): MemoryLog & { destination: { write(chunk: string): void } } {
  const lines: string[] = [];
  return {
    lines,
    destination: { write: (chunk: string) => void lines.push(chunk) },
    records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
    text: () => lines.join('\n'),
    clear: () => void (lines.length = 0),
  };
}

export interface TestApp {
  app: FastifyInstance;
  container: Container;
  env: Env;
  clock: FixedClock;
  log: MemoryLog;
  logger: Logger;
  close(): Promise<void>;
}

export interface TestAppOptions {
  collectorUrl: string;
  engineUrl: string;
  env?: Record<string, string>;
}

export async function createTestApp(opts: TestAppOptions): Promise<TestApp> {
  const env = loadEnv({
    APP_ENV: 'dev',
    LOG_LEVEL: 'debug',
    ARP_DATABASE_URL: opts.collectorUrl,
    ENGINE_URL: opts.engineUrl,
    ENGINE_API_KEY,
    MASTER_KEY,
    ENGINE_TIMEOUT_MS: '2000',
    COLLECTOR_SERVICE_KEYS: `${SERVICE_KEY}, ${SERVICE_KEY_NEW}`,
    FAKE_CANDIDATES_ENABLED: 'true',
    FAKE_CANDIDATES_COUNT: '20',
    DEV_TENANT_ID: '1',
    DEV_ESTABLISHMENT_ID: '10',
    DEV_DEVICE_ID: '100',
    ...opts.env,
  });
  const log = memoryLog();
  const logger = createLogger({ level: env.logLevel, service: 'collector-api', destination: log.destination });
  const clock = new FixedClock(SERVER_NOW);
  const container = createContainer(env, { logger, clock });
  const app = await buildApp(container.appDeps);
  return {
    app,
    container,
    env,
    clock,
    log,
    logger,
    close: async () => {
      await app.close();
      await container.close();
    },
  };
}

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(64),
]);

export interface FormOptions {
  image?: Buffer | null;
  mime?: string;
  deviceSequence?: string | number | null;
  capturedAt?: string | null;
}

/** Monta um multipart real (FormData + Response) para o `inject`. */
export async function multipartBody(opts: FormOptions): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const form = new FormData();
  const image = opts.image === undefined ? JPEG : opts.image;
  if (image !== null) {
    form.append('image', new Blob([new Uint8Array(image)], { type: opts.mime ?? 'image/jpeg' }), 'frame.jpg');
  }
  if (opts.deviceSequence !== null) form.append('deviceSequence', String(opts.deviceSequence ?? 1));
  if (opts.capturedAt !== null) form.append('capturedAt', opts.capturedAt ?? SERVER_NOW);
  const response = new Response(form);
  const payload = Buffer.from(await response.arrayBuffer());
  return { payload, headers: { 'content-type': response.headers.get('content-type') ?? '' } };
}

export async function postPunch(
  t: TestApp,
  opts: FormOptions = {},
  serviceKey: string | null = SERVICE_KEY,
) {
  const { payload, headers } = await multipartBody(opts);
  return t.app.inject({
    method: 'POST',
    url: '/coletor/batidas',
    payload,
    headers: serviceKey === null ? headers : { ...headers, 'x-service-key': serviceKey },
  });
}

/** Porta TCP livre e fechada: simula engine fora do ar. */
export async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sem porta');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${address.port}`;
}
