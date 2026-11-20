#!/usr/bin/env node
/**
 * pnpm setup:dev
 *
 * Cria (ou completa) os dois arquivos de ambiente de desenvolvimento, com
 * segredos gerados e COERENTES entre si:
 *
 *   infra/.env                   compose: senhas do Postgres e dos papéis do arp, Valkey, MASTER_KEY, ENGINE_API_KEY, portas
 *   apps/collector-api/.env.dev  api do coletor: URLs do banco, mesma MASTER_KEY e ENGINE_API_KEY
 *
 * - infra/.env: se já existe, só troca valores vazios ou com TROQUE_ (e acrescenta as chaves novas no fim).
 * - .env.dev: as variáveis que DERIVAM do infra/.env (URLs, porta, chaves da
 *   engine) são sempre alinhadas a ele; o resto só é preenchido se faltar.
 * - Nenhum valor é impresso. Os dois arquivos estão no .gitignore.
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INFRA = path.join(root, 'infra', '.env');
const INFRA_EXAMPLE = path.join(root, 'infra', '.env.example');
const API = path.join(root, 'apps', 'collector-api', '.env.dev');
const API_EXAMPLE = path.join(root, 'apps', 'collector-api', '.env.dev.example');
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

// ---------------------------------------------------------------- infra/.env
const infraCreated = !existsSync(INFRA);
let infraText = readFileSync(infraCreated ? INFRA_EXAMPLE : INFRA, 'utf8');
const infraBefore = parse(infraText);
const infraGenerated = {
  POSTGRES_USER: () => 'genus_admin',
  POSTGRES_PASSWORD: () => hex(16),
  ARP_OWNER_PASSWORD: () => hex(16),
  ARP_COLLECTOR_PASSWORD: () => hex(16),
  ARP_CORE_PASSWORD: () => hex(16),
  ARP_READER_PASSWORD: () => hex(16),
  VALKEY_PASSWORD: () => hex(16),
  VALKEY_PORT: () => '6379',
  MASTER_KEY: () => hex(32),
  ENGINE_API_KEY: () => hex(24),
  POSTGRES_PORT: () => '5432',
  ENGINE_PORT: () => '8001',
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
  out('Erro: MASTER_KEY em infra/.env precisa ter 64 caracteres hexadecimais. Corrija ou apague a linha e rode de novo.');
  process.exit(1);
}
writeFileSync(INFRA, infraText);

// ------------------------------------------------------- apps/collector-api/.env.dev
const apiCreated = !existsSync(API);
let apiText = readFileSync(apiCreated ? API_EXAMPLE : API, 'utf8');
const apiBefore = parse(apiText);
const pgPort = infra.POSTGRES_PORT || '5432';
const derived = {
  ARP_DATABASE_URL: `postgres://arp_collector:${encodeURIComponent(infra.ARP_COLLECTOR_PASSWORD)}@localhost:${pgPort}/arp`,
  ARP_MIGRATION_DATABASE_URL: `postgres://arp_owner:${encodeURIComponent(infra.ARP_OWNER_PASSWORD)}@localhost:${pgPort}/arp`,
  ARP_READER_DATABASE_URL: `postgres://arp_reader:${encodeURIComponent(infra.ARP_READER_PASSWORD)}@localhost:${pgPort}/arp`,
  ENGINE_URL: `http://localhost:${infra.ENGINE_PORT || '8001'}`,
  ENGINE_API_KEY: infra.ENGINE_API_KEY,
  MASTER_KEY: infra.MASTER_KEY,
};
const apiChanged = [];
for (const [key, value] of Object.entries(derived)) {
  if (apiBefore[key] !== value) {
    apiText = setVar(apiText, key, value);
    apiChanged.push(key);
  }
}
const keys = (apiBefore.COLLECTOR_SERVICE_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
if (keys.length === 0 || keys.some((k) => k.includes('TROQUE'))) {
  apiText = setVar(apiText, 'COLLECTOR_SERVICE_KEYS', hex(24));
  apiChanged.push('COLLECTOR_SERVICE_KEYS');
}
writeFileSync(API, apiText);

// -------------------------------------------------------------------- relatório
out(`${infraCreated ? 'Criado' : 'Conferido'}: infra/.env${infraChanged.length ? ` (gerados: ${infraChanged.join(', ')})` : ' (nada a mudar)'}`);
out(`${apiCreated ? 'Criado' : 'Conferido'}: apps/collector-api/.env.dev${apiChanged.length ? ` (ajustados: ${apiChanged.join(', ')})` : ' (nada a mudar)'}`);

// Só senhas do Postgres que já existiam no volume exigem recriar o volume. Papéis novos e o
// Valkey são criados sem isso: o garantir-papeis.sh (rodado pelo dev:up) cria os papéis que faltam.
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
  out('  docker compose -f infra/docker-compose.yml --env-file infra/.env --profile dev down -v');
}
out('');
out('Próximo passo: pnpm dev:up   (sobe Postgres, Valkey e engine, cria papéis que faltam e aplica a migration)');
