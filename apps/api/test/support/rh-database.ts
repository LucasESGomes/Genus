/**
 * Postgres 17 descartável (Testcontainers; exige Docker) com as migrations do
 * banco app aplicadas pelo mesmo runner do contêiner api-migrate.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { waitForClientConnectionsToClose } from '@genus/db-arp';
import { runMigrations } from '../../src/db/migrate';

export interface RhTestDatabase {
  url: string;
  container: StartedPostgreSqlContainer;
  stop(): Promise<void>;
}

/** Mesma versão do compose. `RH_TEST_PG_IMAGE=postgres:15.14-alpine` testa o mínimo suportado (UNIQUE NULLS NOT DISTINCT exige 15+). */
const IMAGE = process.env.RH_TEST_PG_IMAGE ?? 'postgres:17.6-alpine';

export async function startRhTestDatabase(): Promise<RhTestDatabase> {
  const container = await new PostgreSqlContainer(IMAGE).withDatabase('app').start();
  const url = container.getConnectionUri();
  await runMigrations(url);
  return {
    url,
    container,
    stop: async () => {
      await waitForClientConnectionsToClose(url);
      await container.stop();
    },
  };
}
