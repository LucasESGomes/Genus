/**
 * Conexão com o banco `app` (schema rh) via Drizzle. Repositórios recebem `Database`
 * por injeção; nenhum módulo abre conexão por conta própria.
 */
import type { Logger } from '@genus/shared';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string, logger: Logger, max = 10): DatabaseHandle {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', (err) => {
    // Sem err.message: o texto do driver pg pode citar host ou porta.
    logger.error({ err: { name: err.name, code: (err as { code?: string }).code } }, 'pg: erro em conexão ociosa');
  });
  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}
