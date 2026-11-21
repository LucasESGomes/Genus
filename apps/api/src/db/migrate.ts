/**
 * Aplica as migrations do banco `app` (pasta drizzle/), em ordem, numa transação.
 * Usa RH_MIGRATION_DATABASE_URL (papel rh_owner), nunca o papel de runtime.
 *
 *   pnpm --filter @genus/api db:migrate         (lê apps/api/.env.dev)
 *   docker compose up                           (serviço api-migrate)
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function runMigrations(connectionString: string, migrationsFolder: string = MIGRATIONS_DIR): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const url = process.env.RH_MIGRATION_DATABASE_URL;
  if (!url) {
    process.stderr.write('RH_MIGRATION_DATABASE_URL é obrigatória\n');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => process.stdout.write('migrations do banco app aplicadas\n'))
    .catch((err: unknown) => {
      // Só nome e código: a mensagem do pg pode citar host ou valores.
      const e = err as { name?: string; code?: string; message?: string };
      process.stderr.write(`Falha nas migrations: ${e.name ?? 'Error'} ${e.code ?? ''} ${e.message ?? ''}\n`);
      process.exit(1);
    });
}
