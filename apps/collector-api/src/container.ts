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
import { FixedDeviceAuthenticator } from './auth/fixed-device-authenticator';
import { FakeCandidateProvider } from './candidates/fake-candidate-provider';
import type { AppDeps } from './app';
import type { Env } from './config/env';
import { HttpEngineClient } from './engine/http-engine-client';
import { PunchRepository } from './modules/punches/repository';
import { PunchService } from './modules/punches/service';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Sem Valkey configurado (ou falha ao criar): a api sobe e as batidas só não são enfileiradas. */
class DisabledQueuePublisher implements QueuePublisher {
  async publishPunch(): Promise<void> {
    throw new Error('Fila não configurada');
  }
  async ping(): Promise<boolean> {
    return false;
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

  // Provedor real de candidatos (galeria do estabelecimento no banco `app`) ainda não existe.
  // Até lá, só o provedor fictício serve; sem ele a api não tem como montar a lista.
  if (!env.fakeCandidatesEnabled) {
    throw new Error(
      'FAKE_CANDIDATES_ENABLED=false, mas nenhum CandidateProvider real disponível nesta entrega',
    );
  }
  const candidateProvider = new FakeCandidateProvider({
    masterKeyHex: env.masterKey,
    count: env.fakeCandidatesCount,
    tenantId: String(env.devTenantId),
    galleryPath: env.devGalleryPath ? path.resolve(APP_ROOT, env.devGalleryPath) : undefined,
    logger,
  });

  const pool = new pg.Pool({ connectionString: env.arpDatabaseUrl, max: 10 });
  pool.on('error', (err) => {
    logger.error({ err: { name: err.name, message: err.message } }, 'pg: erro em conexão ociosa');
  });

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
      deviceAuthenticator: new FixedDeviceAuthenticator({
        tenantId: env.devTenantId,
        establishmentId: env.devEstablishmentId,
        deviceId: env.devDeviceId,
      }),
      serviceKeys: env.serviceKeys,
      maxImageBytes: env.maxImageBytes,
      exposeTimings: env.exposeTimings,
      // Swagger só em dev (e só para 127.0.0.1/::1, ver plugins/api-docs.ts).
      apiDocs: env.appEnv === 'dev',
    },
    close: async () => {
      await closablePublisher?.close();
      await pool.end();
    },
  };
}
