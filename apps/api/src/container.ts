/**
 * Monta as dependências reais a partir do ambiente. Os testes usam o mesmo
 * container, trocando só logger e relógio.
 */
import { createLogger, SystemClock, type Clock, type Logger } from '@genus/shared';
import type { AppDeps } from './app';
import type { Env } from './config/env';
import { createDatabase, type DatabaseHandle } from './db/client';

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
    },
    close: () => database.close(),
  };
}
