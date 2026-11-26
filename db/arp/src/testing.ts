import { randomBytes } from "node:crypto";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { migrate } from "./migrate";

export interface ArpTestDatabase {
  /** Conexão do dono (`arp_owner`): aplica migrations e lê tudo. */
  ownerUrl: string;
  /** Conexão do papel `arp_collector` (só SELECT/INSERT em `entradas`), como a api do coletor. */
  collectorUrl: string;
  /** Conexão do papel `arp_core` (rep-core): escreve em `registros`, `evidencias`, `outbox` e atualiza `entradas`. */
  coreUrl: string;
  /** Conexão do papel `arp_reader` (somente leitura): resgate e verificação da cadeia. */
  readerUrl: string;
  /** Superusuário do container, no banco `arp`. Só para provar que até ele é barrado pelos triggers. */
  adminUrl: string;
  /** Derruba o container. */
  stop(): Promise<void>;
}

/**
 * Sobe um Postgres 17 descartável (Testcontainers; exige Docker), cria os papéis
 * `arp_owner`, `arp_collector`, `arp_core` e `arp_reader` e o banco `arp` com as mesmas
 * permissões do init do compose, e aplica as migrations como `arp_owner`.
 * Permissões de tabela vêm das migrations, não daqui.
 */
export async function startArpTestDatabase(): Promise<ArpTestDatabase> {
  const container = await new PostgreSqlContainer("postgres:17.6-alpine").start();
  const ownerPassword = randomBytes(16).toString("hex");
  const collectorPassword = randomBytes(16).toString("hex");
  const corePassword = randomBytes(16).toString("hex");
  const readerPassword = randomBytes(16).toString("hex");
  const base = `${container.getHost()}:${container.getPort()}`;

  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  try {
    await admin.query(`CREATE ROLE arp_owner LOGIN PASSWORD '${ownerPassword}'`);
    await admin.query(`CREATE ROLE arp_collector LOGIN PASSWORD '${collectorPassword}'`);
    await admin.query(`CREATE ROLE arp_core LOGIN PASSWORD '${corePassword}'`);
    await admin.query(`CREATE ROLE arp_reader LOGIN PASSWORD '${readerPassword}'`);
    await admin.query("CREATE DATABASE arp OWNER arp_owner");
    await admin.query("REVOKE ALL ON DATABASE arp FROM PUBLIC");
    await admin.query(
      "GRANT CONNECT ON DATABASE arp TO arp_owner, arp_collector, arp_core, arp_reader",
    );
  } finally {
    await admin.end();
  }

  const superuserArpUrl = `postgres://${container.getUsername()}:${container.getPassword()}@${base}/arp`;
  const schemaAdmin = new pg.Client({ connectionString: superuserArpUrl });
  await schemaAdmin.connect();
  try {
    await schemaAdmin.query("ALTER SCHEMA public OWNER TO arp_owner");
    await schemaAdmin.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    await schemaAdmin.query("GRANT USAGE ON SCHEMA public TO arp_collector, arp_core, arp_reader");
  } finally {
    await schemaAdmin.end();
  }

  const ownerUrl = `postgres://arp_owner:${ownerPassword}@${base}/arp`;
  const collectorUrl = `postgres://arp_collector:${collectorPassword}@${base}/arp`;
  const coreUrl = `postgres://arp_core:${corePassword}@${base}/arp`;
  const readerUrl = `postgres://arp_reader:${readerPassword}@${base}/arp`;
  try {
    await migrate(ownerUrl);
  } catch (err) {
    await container.stop();
    throw err;
  }
  return {
    ownerUrl,
    collectorUrl,
    coreUrl,
    readerUrl,
    adminUrl: superuserArpUrl,
    stop: async () => {
      await waitForClientConnectionsToClose(container.getConnectionUri());
      await container.stop();
    },
  };
}

/**
 * Espera as conexões dos testes saírem do Postgres antes de derrubar o container.
 * `pool.end()` do pg resolve antes de os sockets fecharem; parar o container nesse
 * intervalo manda `57P01` (terminating connection) a clientes sem ouvinte de erro,
 * e o Vitest acusa exceção não tratada mesmo com todos os testes passando.
 */
export async function waitForClientConnectionsToClose(
  superuserUrl: string,
  // Abaixo do hookTimeout padrão do Vitest (10 s): se algo vazar conexão, o afterAll ainda termina.
  timeoutMs = 3_000,
): Promise<void> {
  const admin = new pg.Client({ connectionString: superuserUrl });
  await admin.connect();
  try {
    const pollMs = 50;
    for (let attempt = 0; attempt * pollMs < timeoutMs; attempt++) {
      const { rows } = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()`,
      );
      if (rows[0]!.n === 0) return;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    await admin.end();
  }
}
