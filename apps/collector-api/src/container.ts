/**
 * Monta as dependências reais a partir do ambiente. Os testes usam o mesmo
 * container, trocando só logger e relógio.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  createLogger,
  SystemClock,
  type CandidateProvider,
  type Clock,
  type EngineClient,
  type Logger,
  type QueuePublisher,
} from '@genus/shared';
import { createProducerConnection, createQueuePublisher, type ClosableQueuePublisher } from '@genus/queue';
import pg from 'pg';
import { DbCandidateProvider } from './candidates/db-candidate-provider';
import { DbDeviceAuthenticator } from './auth/db-device-authenticator';
import { FixedDeviceAuthenticator } from './auth/fixed-device-authenticator';
import { FakeCandidateProvider } from './candidates/fake-candidate-provider';
import type { AppDeps } from './app';
import type { Env } from './config/env';
import { HttpEngineClient } from './engine/http-engine-client';
import { PunchRepository } from './modules/punches/repository';
import { PunchService } from './modules/punches/service';
import { PunchStatusService } from './modules/punches/status-service';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Sem Valkey configurado (ou falha ao criar): a api sobe e as batidas só não são enfileiradas. */
class DisabledQueuePublisher implements QueuePublisher {
  async publishPunch(): Promise<void> {
    throw new Error('Fila não configurada');
  }
  async ping(): Promise<boolean> {
    return false;
  }
  async getPunchJob(): Promise<null> {
    throw new Error('Fila não configurada');
  }
}

function createOptionalPublisher(env: Env, logger: Logger): ClosableQueuePublisher | undefined {
  if (env.valkeyUrl === undefined) {
    logger.warn({ event: 'queue_disabled' }, 'fila: VALKEY_URL ausente; batidas não serão enfileiradas (o resgate cobre)');
    return undefined;
  }
  try {
    const connection = createProducerConnection({
      url: env.valkeyUrl,
      password: env.valkeyPassword,
      publishTimeoutMs: env.queuePublishTimeoutMs,
    });
    return createQueuePublisher({
      connection,
      logger,
      timeoutMs: env.queuePublishTimeoutMs,
      attempts: env.queueAttempts,
    });
  } catch (err) {
    logger.error(
      { event: 'queue_disabled', err: { name: err instanceof Error ? err.name : 'unknown' } },
      'fila: falha ao criar o publicador; seguindo sem fila',
    );
    return undefined;
  }
}

export interface Container {
  appDeps: AppDeps;
  logger: Logger;
  pool: pg.Pool;
  candidateProvider: CandidateProvider;
  engine: EngineClient;
  repository: PunchRepository;
  queuePublisher: QueuePublisher;
  close(): Promise<void>;
}

export function createContainer(
  env: Env,
  overrides: { logger?: Logger; clock?: Clock; queuePublisher?: QueuePublisher } = {},
): Container {
  const logger = overrides.logger ?? createLogger({ level: env.logLevel, service: 'collector-api' });
  const clock = overrides.clock ?? new SystemClock();

  const pool = new pg.Pool({ connectionString: env.arpDatabaseUrl, max: 10 });
  pool.on('error', (err) => {
    // Sem err.message: o texto do driver pg pode citar host ou porta.
    logger.error({ err: { name: err.name, code: (err as { code?: string }).code } }, 'pg: erro em conexão ociosa');
  });

  // Banco `app` só para leitura (papel genus_coletor_leitura): chave do aparelho e candidatos reais.
  const appPool = env.appReadonlyDatabaseUrl
    ? new pg.Pool({ connectionString: env.appReadonlyDatabaseUrl, max: 5 })
    : undefined;
  appPool?.on('error', (err) => {
    logger.error({ err: { name: err.name, code: (err as { code?: string }).code } }, 'pg(app): erro em conexão ociosa');
  });

  let candidateProvider: CandidateProvider;
  if (env.fakeCandidatesEnabled) {
    candidateProvider = new FakeCandidateProvider({
      masterKeyHex: env.masterKey,
      count: env.fakeCandidatesCount,
      tenantId: String(env.devTenantId),
      galleryPath: env.devGalleryPath ? path.resolve(APP_ROOT, env.devGalleryPath) : undefined,
      logger,
    });
  } else {
    if (!appPool) throw new Error('APP_READONLY_DATABASE_URL ausente');
    candidateProvider = new DbCandidateProvider({ pool: appPool, clock, logger });
  }

  const engine = new HttpEngineClient({
    baseUrl: env.engineUrl,
    apiKey: env.engineApiKey,
    timeoutMs: env.engineTimeoutMs,
    maxConcurrency: env.engineMaxConcurrency,
    logger,
  });

  const closablePublisher = overrides.queuePublisher ? undefined : createOptionalPublisher(env, logger);
  const queuePublisher: QueuePublisher =
    overrides.queuePublisher ?? closablePublisher ?? new DisabledQueuePublisher();

  const repository = new PunchRepository(pool);
  const punchService = new PunchService({
    repository,
    candidates: candidateProvider,
    engine,
    clock,
    logger,
    queuePublisher,
  });
  const punchStatusService = new PunchStatusService({ repository, queuePublisher, logger });

  return {
    logger,
    pool,
    candidateProvider,
    engine,
    repository,
    queuePublisher,
    appDeps: {
      logger,
      pool,
      engine,
      queuePublisher,
      punchService,
      punchStatusService,
      deviceAuthenticator: new FixedDeviceAuthenticator({
        tenantId: env.devTenantId,
        establishmentId: env.devEstablishmentId,
        deviceId: env.devDeviceId,
      }),
      totemDeviceAuthenticator: appPool
        ? new DbDeviceAuthenticator({ pool: appPool, clock, logger })
        : undefined,
      serviceKeys: env.serviceKeys,
      maxImageBytes: env.maxImageBytes,
      exposeTimings: env.exposeTimings,
      // Swagger só em dev (e só para 127.0.0.1/::1, ver plugins/api-docs.ts).
      apiDocs: env.appEnv === 'dev',
    },
    close: async () => {
      await closablePublisher?.close();
      await pool.end();
      await appPool?.end();
    },
  };
}
