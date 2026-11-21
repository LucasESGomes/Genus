/**
 * Aplica as migrations do banco arp.
 *
 *   pnpm db:migrate:arp                     # ambiente dev: lê apps/collector-api/.env.dev
 *   pnpm db:migrate:arp -- --env prod       # lê apps/collector-api/.env.prod
 *   pnpm db:migrate:arp -- --env-file <arq> # arquivo explícito
 *
 * A URL vem de ARP_MIGRATION_DATABASE_URL (papel arp_owner). Se a variável já
 * estiver no ambiente do processo, ela vence o arquivo. O valor nunca é impresso.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { migrate } from "./migrate";

const ENVIRONMENTS = ["dev", "homolog", "prod"] as const;
const VAR = "ARP_MIGRATION_DATABASE_URL";
const COLLECTOR_DIR = fileURLToPath(new URL("../../../apps/collector-api/", import.meta.url));

function fail(message: string): never {
  process.stderr.write(`Erro: ${message}\n`);
  process.exit(1);
}

// O pnpm pode repassar o "--" literal; ignore-o.
const args = process.argv.slice(2).filter((a) => a !== "--");
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) fail(`${name} precisa de um valor.`);
  return value;
}

const envName = option("--env") ?? process.env["APP_ENV"] ?? "dev";
if (!(ENVIRONMENTS as readonly string[]).includes(envName)) {
  fail(`--env deve ser ${ENVIRONMENTS.join(", ")} (recebido: ${envName}).`);
}
const explicitFile = option("--env-file");
const envFile = explicitFile ? resolve(process.cwd(), explicitFile) : resolve(COLLECTOR_DIR, `.env.${envName}`);

let url = process.env[VAR];
let source = "variável de ambiente do processo";
if (!url) {
  if (!existsSync(envFile)) {
    fail(
      `${VAR} não está no ambiente e o arquivo ${envFile} não existe.\n` +
        `Crie-o a partir de ${resolve(COLLECTOR_DIR, `.env.${envName}.example`)} ou passe --env-file <arquivo>.`,
    );
  }
  url = parseEnv(readFileSync(envFile, "utf8"))[VAR];
  source = envFile;
  if (!url) fail(`${VAR} não está definida em ${envFile}.`);
}
if (url.includes("TROQUE")) fail(`${VAR} ainda tem o placeholder TROQUE_ (${source}).`);

process.stdout.write(`Ambiente: ${envName}. URL lida de: ${source}.\n`);
try {
  const { applied, skipped } = await migrate(url);
  for (const f of applied) process.stdout.write(`aplicada: ${f}\n`);
  for (const f of skipped) process.stdout.write(`já aplicada: ${f}\n`);
  process.stdout.write(`${applied.length} aplicada(s), ${skipped.length} já existente(s).\n`);
} catch (err) {
  process.stderr.write(`Falha na migration: ${describeError(err)}\n`);
  process.exit(1);
}

/** Erro de conexão do `pg` chega como AggregateError sem mensagem; mostre o código. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: string }).code;
  if (code === "ECONNREFUSED") {
    return "o Postgres não aceitou a conexão (ECONNREFUSED). Ele está no ar e na porta da URL? Veja `docker ps`.";
  }
  if (code === "28P01") return "senha recusada para o papel arp_owner (28P01). Confira a senha na URL e no .env da raiz.";
  if (code === "3D000") return "o banco arp não existe (3D000). Suba o serviço db-roles (docker compose up db-roles), que cria os bancos.";
  const inner = err instanceof AggregateError ? err.errors.map((e: unknown) => describeError(e)).join("; ") : "";
  return err.message || inner || code || err.name;
}
