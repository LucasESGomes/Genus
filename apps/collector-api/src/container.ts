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
} from '@genus/shared';
import pg from 'pg';
import { FixedDeviceAuthenticator } from './auth/fixed-device-authenticator';
import { FakeCandidateProvider } from './candidates/fake-candidate-provider';
import type { AppDeps } from './app';
import type { Env } from './config/env';
import { HttpEngineClient } from './engine/http-engine-client';
import { PunchRepository } from './modules/punches/repository';
import { PunchService } from './modules/punches/service';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

export interface Container {
  appDeps: AppDeps;
  logger: Logger;
  pool: pg.Pool;
  candidateProvider: CandidateProvider;
  engine: EngineClient;
  repository: PunchRepository;
  close(): Promise<void>;
}

export function createContainer(
  env: Env,
  overrides: { logger?: Logger; clock?: Clock } = {},
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

  const repository = new PunchRepository(pool);
  const punchService = new PunchService({ repository, candidates: candidateProvider, engine, clock, logger });

  return {
    logger,
    pool,
    candidateProvider,
    engine,
    repository,
    appDeps: {
      logger,
      pool,
      engine,
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
    close: () => pool.end(),
  };
}
