/**
 * Monta as dependências reais a partir do ambiente. Os testes usam o mesmo
 * container, trocando só logger e relógio.
 */
import { createLogger, SystemClock, type Clock, type Logger } from '@genus/shared';
import type { AppDeps } from './app';
import type { Env } from './config/env';
import { createDatabase, type DatabaseHandle } from './db/client';
import { createAuth } from './modules/auth/auth';
import pg from 'pg';
import { PgArpPunchReader } from './arp/punch-reader';
import { PortalAccess } from './http/access';
import { HttpFacialEngineClient } from './modules/facial/engine-client';
import { LocalDiskStorage } from './storage/file-storage';

export interface Container {
  appDeps: AppDeps;
  logger: Logger;
  clock: Clock;
  database: DatabaseHandle;
  close(): Promise<void>;
}

export function createContainer(env: Env, overrides: { logger?: Logger; clock?: Clock } = {}): Container {
  const logger = overrides.logger ?? createLogger({ level: env.logLevel, service: 'api' });
  const clock = overrides.clock ?? new SystemClock();
  const database = createDatabase(env.databaseUrl, logger, env.databasePoolMax);
  const auth = createAuth(
    database.db,
    {
      secret: env.authSecret,
      baseURL: env.authBaseUrl,
      trustedOrigins: env.corsOrigins,
      secureCookies: env.appEnv !== 'dev',
    },
    logger,
  );

  // Banco arp: só leitura (papel arp_reader). Pool pequeno: a apuração lê por colaborador e dia.
  const arpPool = new pg.Pool({ connectionString: env.arpReaderDatabaseUrl, max: 4 });
  arpPool.on('error', (err) => {
    logger.error({ err: { name: err.name, code: (err as { code?: string }).code } }, 'pg arp: erro em conexão ociosa');
  });
  const pinPepper = { version: env.pinPepper.version, key: Buffer.from(env.pinPepper.keyHex, 'hex') };

  return {
    logger,
    clock,
    database,
    appDeps: {
      logger,
      pool: database.pool,
      db: database.db,
      corsOrigins: env.corsOrigins,
      apiDocs: env.appEnv === 'dev',
      auth: { auth, baseURL: env.authBaseUrl, clock },
      portal: {
        db: database.db,
        clock,
        access: new PortalAccess(env.gestorEnabled),
        arp: new PgArpPunchReader(arpPool),
        storage: new LocalDiskStorage(env.attachmentsDir),
        engine: env.engine ? new HttpFacialEngineClient({ baseUrl: env.engine.url, apiKey: env.engine.apiKey }) : null,
        pin: { current: pinPepper, all: [pinPepper] },
        maxAttachmentBytes: env.maxAttachmentBytes,
      },
    },
    close: async () => {
      await arpPool.end();
      await database.close();
    },
  };
}
