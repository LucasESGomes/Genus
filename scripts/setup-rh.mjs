#!/usr/bin/env node
/**
 * pnpm setup:rh
 *
 * Cria (ou completa) os arquivos de ambiente da parte de RH, com segredos gerados
 * e COERENTES entre si:
 *
 *   .env                 compose da raiz: senhas do postgres-rh (rh_owner, rh_api), portas
 *   apps/api/.env.dev    api do portal fora do Docker: URLs do banco app em localhost
 *
 * - .env: se já existe, só troca valores vazios ou com TROQUE_ (e acrescenta as chaves novas no fim).
 * - .env.dev: as URLs do banco DERIVAM do .env e são sempre alinhadas a ele; o resto só é preenchido se faltar.
 * - Nenhum valor é impresso. Os arquivos estão no .gitignore.
 * Mesmo padrão de scripts/setup-dev.mjs (que cuida de infra/.env e dos apps do ponto).
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_ENV = path.join(root, '.env');
const ROOT_EXAMPLE = path.join(root, '.env.example');
const API = path.join(root, 'apps', 'api', '.env.dev');
const API_EXAMPLE = path.join(root, 'apps', 'api', '.env.dev.example');
const PG_VOLUME = 'genus-postgres-rh-dados';

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
const rootCreated = !existsSync(ROOT_ENV);
let rootText = readFileSync(rootCreated ? ROOT_EXAMPLE : ROOT_ENV, 'utf8');
const rootBefore = parse(rootText);
const generated = {
  RH_POSTGRES_USER: () => 'genus_rh_admin',
  RH_POSTGRES_PASSWORD: () => hex(16),
  RH_OWNER_PASSWORD: () => hex(16),
  RH_API_PASSWORD: () => hex(16),
  RH_POSTGRES_PORT: () => '5433',
  API_PORT: () => '3002',
};
const rootChanged = [];
for (const [key, gen] of Object.entries(generated)) {
  if (isPlaceholder(rootBefore[key])) {
    rootText = setVar(rootText, key, gen());
    rootChanged.push(key);
  }
}
writeFileSync(ROOT_ENV, rootText);
const env = parse(rootText);

// ---------------------------------------------------------------- apps/api/.env.dev
const apiCreated = !existsSync(API);
let apiText = readFileSync(apiCreated ? API_EXAMPLE : API, 'utf8');
const apiBefore = parse(apiText);
const port = env.RH_POSTGRES_PORT || '5433';
const derived = {
  RH_DATABASE_URL: `postgres://rh_api:${encodeURIComponent(env.RH_API_PASSWORD)}@localhost:${port}/app`,
  RH_MIGRATION_DATABASE_URL: `postgres://rh_owner:${encodeURIComponent(env.RH_OWNER_PASSWORD)}@localhost:${port}/app`,
  PORT: env.API_PORT || '3002',
};
// Leitura do arp (pnpm rh:check-arp): papel somente leitura, senha e porta do infra/.env (pnpm setup:dev).
const INFRA = path.join(root, 'infra', '.env');
if (existsSync(INFRA)) {
  const infra = parse(readFileSync(INFRA, 'utf8'));
  if (!isPlaceholder(infra.ARP_READER_PASSWORD)) {
    derived.ARP_READER_DATABASE_URL = `postgres://arp_reader:${encodeURIComponent(infra.ARP_READER_PASSWORD)}@localhost:${infra.POSTGRES_PORT || '5432'}/arp`;
  }
}
const apiChanged = [];
for (const [key, value] of Object.entries(derived)) {
  if (apiBefore[key] !== value) {
    apiText = setVar(apiText, key, value);
    apiChanged.push(key);
  }
}
writeFileSync(API, apiText);

// -------------------------------------------------------------------- relatório
out(`${rootCreated ? 'Criado' : 'Conferido'}: .env${rootChanged.length ? ` (gerados: ${rootChanged.join(', ')})` : ' (nada a mudar)'}`);
out(`${apiCreated ? 'Criado' : 'Conferido'}: apps/api/.env.dev${apiChanged.length ? ` (ajustados: ${apiChanged.join(', ')})` : ' (nada a mudar)'}`);

// O init do postgres-rh só roda na primeira subida: senha nova com volume antigo não bate.
const PG_KEYS = ['RH_POSTGRES_USER', 'RH_POSTGRES_PASSWORD', 'RH_OWNER_PASSWORD', 'RH_API_PASSWORD'];
let volumeExists = false;
try {
  execFileSync('docker', ['volume', 'inspect', PG_VOLUME], { stdio: 'ignore' });
  volumeExists = true;
} catch {
  // sem Docker ou sem o volume: nada a avisar
}
if (rootChanged.some((k) => PG_KEYS.includes(k)) && volumeExists) {
  out('');
  out(`ATENÇÃO: o volume ${PG_VOLUME} já existe e foi criado com OUTRAS senhas (o init só roda na primeira subida).`);
  out('Recrie o volume (apaga os dados locais do banco de RH):');
  out('  docker compose rm -sf postgres-rh && docker volume rm genus-postgres-rh-dados');
}
