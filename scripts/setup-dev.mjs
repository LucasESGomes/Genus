#!/usr/bin/env node
/**
 * pnpm setup:dev
 *
 * Cria (ou completa) os arquivos de ambiente de desenvolvimento, com
 * segredos gerados e COERENTES entre si:
 *
 *   .env                         TODOS os docker-compose.yml: senhas do Postgres e dos papéis (arp e app), Valkey, MASTER_KEY, ENGINE_API_KEY, chaves do coletor, portas
 *   apps/collector-api/.env.dev  api do coletor: URLs do banco, Valkey, mesma MASTER_KEY e ENGINE_API_KEY
 *   apps/rep-core/.env.dev       rep-core: ARP_CORE_DATABASE_URL, Valkey (docs/SPEC-nsr-fila.md §9)
 *   apps/jobs/.env.dev           jobs: ARP_READER_DATABASE_URL, Valkey (docs/SPEC-nsr-fila.md §9)
 *   apps/api/.env.dev            api do portal de RH: URLs do banco app (rh_api e rh_owner) e leitura do arp
 *
 * Os .env.dev servem para rodar os processos FORA do Docker (`pnpm dev`). Dentro do Docker, o
 * docker-compose.yml de cada app monta as variáveis a partir do .env da raiz.
 *
 * - .env: se já existe, só troca valores vazios ou com TROQUE_ (e acrescenta as chaves novas no fim).
 * - .env.dev: as variáveis que DERIVAM do .env (URLs, porta, chaves da
 *   engine, Valkey) são sempre alinhadas a ele; o resto só é preenchido se faltar.
 * - Nenhum valor é impresso. Os arquivos estão no .gitignore.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_ENV = path.join(root, '.env');
const ROOT_EXAMPLE = path.join(root, '.env.example');
const API = path.join(root, 'apps', 'collector-api', '.env.dev');
const API_EXAMPLE = path.join(root, 'apps', 'collector-api', '.env.dev.example');
const REP_CORE = path.join(root, 'apps', 'rep-core', '.env.dev');
const REP_CORE_EXAMPLE = path.join(root, 'apps', 'rep-core', '.env.dev.example');
const JOBS = path.join(root, 'apps', 'jobs', '.env.dev');
const JOBS_EXAMPLE = path.join(root, 'apps', 'jobs', '.env.dev.example');
const PORTAL = path.join(root, 'apps', 'api', '.env.dev');
const PORTAL_EXAMPLE = path.join(root, 'apps', 'api', '.env.dev.example');
const PG_VOLUME = 'genus-postgres-arp-app-dados';

const out = (line = '') => process.stdout.write(`${line}\n`);
const hex = (bytes) => randomBytes(bytes).toString('hex');
const isPlaceholder = (v) => v === undefined || v === '' || v.includes('TROQUE');

function parse(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) values[m[1]] = m[2];
  }
  return values;
}

/** Troca o valor de KEY preservando comentários e ordem; acrescenta no fim se não existir. */
function setVar(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, `${key}=${value}`) : `${text.replace(/\n*$/, '\n')}${key}=${value}\n`;
}

// ---------------------------------------------------------------- .env da raiz
const infraCreated = !existsSync(ROOT_ENV);
let infraText = readFileSync(infraCreated ? ROOT_EXAMPLE : ROOT_ENV, 'utf8');
const infraBefore = parse(infraText);
const infraGenerated = {
  POSTGRES_USER: () => 'genus_admin',
  POSTGRES_PASSWORD: () => hex(16),
  ARP_OWNER_PASSWORD: () => hex(16),
  ARP_COLLECTOR_PASSWORD: () => hex(16),
  ARP_CORE_PASSWORD: () => hex(16),
  ARP_READER_PASSWORD: () => hex(16),
  RH_OWNER_PASSWORD: () => hex(16),
  RH_API_PASSWORD: () => hex(16),
  COLETOR_LEITURA_PASSWORD: () => hex(16),
  VALKEY_PASSWORD: () => hex(16),
  VALKEY_PORT: () => '6379',
  MASTER_KEY: () => hex(32),
  ENGINE_API_KEY: () => hex(24),
  POSTGRES_PORT: () => '5432',
  ENGINE_PORT: () => '8001',
  COLLECTOR_SERVICE_KEYS: () => hex(24),
  COLLECTOR_PORT: () => '3001',
  API_PORT: () => '3002',
  CORS_ORIGINS: () => 'http://localhost:3000',
  // Segredo do Better Auth (login do portal de RH): assina cookies e cifra os segredos de 2FA e do JWT.
  BETTER_AUTH_SECRET: () => hex(32),
  // Pepper do PIN do colaborador (HMAC antes do scrypt). Trocar invalida os PINs: só com rotação (PIN_PEPPER_VERSION).
  PIN_PEPPER: () => hex(32),
  // Chave AES-256 do dado de saúde da análise de atestado (CID, texto e evidências cifrados na coluna).
  CERTIFICATE_DATA_KEY: () => hex(32),
};
const infraChanged = [];
for (const [key, gen] of Object.entries(infraGenerated)) {
  if (isPlaceholder(infraBefore[key])) {
    infraText = setVar(infraText, key, gen());
    infraChanged.push(key);
  }
}
const infra = parse(infraText);
if (!/^[0-9a-f]{64}$/i.test(infra.MASTER_KEY)) {
  out('Erro: MASTER_KEY no .env precisa ter 64 caracteres hexadecimais. Corrija ou apague a linha e rode de novo.');
  process.exit(1);
}
writeFileSync(ROOT_ENV, infraText);

// ------------------------------------------------------- apps/collector-api/.env.dev
const apiCreated = !existsSync(API);
let apiText = readFileSync(apiCreated ? API_EXAMPLE : API, 'utf8');
const apiBefore = parse(apiText);
const pgPort = infra.POSTGRES_PORT || '5432';
// Valkey: URL sem senha; a senha vem separada (docs/SPEC-nsr-fila.md §9).
const valkeyDerived = {
  VALKEY_URL: `redis://localhost:${infra.VALKEY_PORT || '6379'}`,
  VALKEY_PASSWORD: infra.VALKEY_PASSWORD,
};
const derived = {
  ...valkeyDerived,
  ARP_DATABASE_URL: `postgres://arp_collector:${encodeURIComponent(infra.ARP_COLLECTOR_PASSWORD)}@localhost:${pgPort}/arp`,
  ARP_MIGRATION_DATABASE_URL: `postgres://arp_owner:${encodeURIComponent(infra.ARP_OWNER_PASSWORD)}@localhost:${pgPort}/arp`,
  ARP_READER_DATABASE_URL: `postgres://arp_reader:${encodeURIComponent(infra.ARP_READER_PASSWORD)}@localhost:${pgPort}/arp`,
  // O .env.dev do coletor é o compartilhado: rep-core (dev:rep-core, arp:verify-chain) lê daqui.
  ARP_CORE_DATABASE_URL: `postgres://arp_core:${encodeURIComponent(infra.ARP_CORE_PASSWORD)}@localhost:${pgPort}/arp`,
  // Banco app, somente leitura: chave do aparelho (totem) e candidatos reais.
  APP_READONLY_DATABASE_URL: `postgres://genus_coletor_leitura:${encodeURIComponent(infra.COLETOR_LEITURA_PASSWORD)}@localhost:${pgPort}/app`,
  ENGINE_URL: `http://localhost:${infra.ENGINE_PORT || '8001'}`,
  ENGINE_API_KEY: infra.ENGINE_API_KEY,
  MASTER_KEY: infra.MASTER_KEY,
  COLLECTOR_SERVICE_KEYS: infra.COLLECTOR_SERVICE_KEYS,
};
const apiChanged = [];
for (const [key, value] of Object.entries(derived)) {
  if (apiBefore[key] !== value) {
    apiText = setVar(apiText, key, value);
    apiChanged.push(key);
  }
}
// Chaves da fila com valor padrão: preenchidas só se faltarem (não sobrescrevem ajustes do dev).
const API_QUEUE_DEFAULTS = { QUEUE_PUBLISH_TIMEOUT_MS: '250', QUEUE_ATTEMPTS: '5' };
for (const [key, value] of Object.entries(API_QUEUE_DEFAULTS)) {
  if (isPlaceholder(apiBefore[key])) {
    apiText = setVar(apiText, key, value);
    apiChanged.push(key);
  }
}
writeFileSync(API, apiText);

// ------------------------------------------- rep-core e jobs (mesmo padrão de derivação)
/**
 * Escreve um .env.dev de um processo: base = o .env.dev existente, senão o .env.dev.example,
 * senão um texto mínimo embutido. Derivados são alinhados ao .env da raiz; padrões só entram se faltarem.
 */
function syncEnv({ file, example, fallback, derived: values, defaults = {} }) {
  const created = !existsSync(file);
  let text = !created ? readFileSync(file, 'utf8') : existsSync(example) ? readFileSync(example, 'utf8') : fallback;
  const before = parse(text);
  const changed = [];
  for (const [key, value] of Object.entries(values)) {
    if (before[key] !== value) {
      text = setVar(text, key, value);
      changed.push(key);
    }
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (isPlaceholder(before[key])) {
      text = setVar(text, key, value);
      changed.push(key);
    }
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  const rel = path.relative(root, file).split(path.sep).join('/');
  return `${created ? 'Criado' : 'Conferido'}: ${rel}${changed.length ? ` (ajustados: ${changed.join(', ')})` : ' (nada a mudar)'}`;
}

const repCoreMsg = syncEnv({
  file: REP_CORE,
  example: REP_CORE_EXAMPLE,
  fallback: '# Gerado por scripts/setup-dev.mjs. Variáveis: docs/SPEC-nsr-fila.md §9.\n',
  derived: {
    ARP_CORE_DATABASE_URL: `postgres://arp_core:${encodeURIComponent(infra.ARP_CORE_PASSWORD)}@localhost:${pgPort}/arp`,
    ...valkeyDerived,
  },
  defaults: { WORKER_CONCURRENCY: '4', QUEUE_ATTEMPTS: '5' },
});
const jobsMsg = syncEnv({
  file: JOBS,
  example: JOBS_EXAMPLE,
  fallback: '# Gerado por scripts/setup-dev.mjs. Variáveis: docs/SPEC-nsr-fila.md §9.\n',
  derived: {
    ARP_READER_DATABASE_URL: `postgres://arp_reader:${encodeURIComponent(infra.ARP_READER_PASSWORD)}@localhost:${pgPort}/arp`,
    ...valkeyDerived,
  },
  defaults: { RESCUE_INTERVAL_MS: '20000', RESCUE_MIN_AGE_MS: '30000', POST_PUNCH_DEPTH_WARN: '10000' },
});

// ------------------------------------------------- apps/api/.env.dev (portal de RH)
const portalMsg = syncEnv({
  file: PORTAL,
  example: PORTAL_EXAMPLE,
  fallback: '# Gerado por scripts/setup-dev.mjs.\n',
  derived: {
    // Mesma instância Postgres do arp: banco `app`, papéis rh_api (runtime) e rh_owner (migrations).
    RH_DATABASE_URL: `postgres://rh_api:${encodeURIComponent(infra.RH_API_PASSWORD)}@localhost:${pgPort}/app`,
    RH_MIGRATION_DATABASE_URL: `postgres://rh_owner:${encodeURIComponent(infra.RH_OWNER_PASSWORD)}@localhost:${pgPort}/app`,
    ARP_READER_DATABASE_URL: `postgres://arp_reader:${encodeURIComponent(infra.ARP_READER_PASSWORD)}@localhost:${pgPort}/arp`,
    PORT: infra.API_PORT || '3002',
    CORS_ORIGINS: infra.CORS_ORIGINS || 'http://localhost:3000',
    BETTER_AUTH_SECRET: infra.BETTER_AUTH_SECRET,
    AUTH_BASE_URL: `http://localhost:${infra.API_PORT || '3002'}`,
    PIN_PEPPER: infra.PIN_PEPPER,
    CERTIFICATE_DATA_KEY: infra.CERTIFICATE_DATA_KEY,
    // Cadastro facial no totem: só chama POST /embeddings/register da engine.
    ENGINE_URL: `http://localhost:${infra.ENGINE_PORT || '8001'}`,
    ENGINE_API_KEY: infra.ENGINE_API_KEY,
  },
});

// -------------------------------------------------------------------- relatório
out(`${infraCreated ? 'Criado' : 'Conferido'}: .env${infraChanged.length ? ` (gerados: ${infraChanged.join(', ')})` : ' (nada a mudar)'}`);
out(`${apiCreated ? 'Criado' : 'Conferido'}: apps/collector-api/.env.dev${apiChanged.length ? ` (ajustados: ${apiChanged.join(', ')})` : ' (nada a mudar)'}`);
out(repCoreMsg);
out(jobsMsg);
out(portalMsg);

// Só a senha do superusuário do Postgres que já existia no volume exige recriar o volume. Papéis novos
// (e os do RH) são criados sem isso: o serviço db-roles (db/postgres/bootstrap.sh) cria o que falta.
const PG_KEYS = ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'ARP_OWNER_PASSWORD', 'ARP_COLLECTOR_PASSWORD'];
const pgChanged = infraChanged.some((k) => PG_KEYS.includes(k));
let volumeExists = false;
try {
  execFileSync('docker', ['volume', 'inspect', PG_VOLUME], { stdio: 'ignore' });
  volumeExists = true;
} catch {
  // sem Docker ou sem o volume: nada a avisar
}
if (pgChanged && volumeExists) {
  out('');
  out(`ATENÇÃO: o volume ${PG_VOLUME} já existe e foi criado com OUTRAS senhas do Postgres (o init só roda na primeira subida).`);
  out('Recrie o volume (apaga os dados locais do Postgres de dev):');
  out('  docker compose down -v');
}
out('');
out('Próximo passo: docker compose up -d   (tudo no Docker)  ou  pnpm dev   (infra no Docker e processos Node no host)');
