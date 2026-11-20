#!/usr/bin/env node
/**
 * pnpm queue:inspect
 *
 * Mostra, para cada fila de batidas, a contagem de jobs por estado, e a profundidade
 * da `post-punch` (waiting + delayed + active). Avisa se a profundidade passar de
 * POST_PUNCH_DEPTH_WARN (padrão 10000). Docs: docs/SPEC-nsr-fila.md §11.
 *
 * Lê VALKEY_URL e VALKEY_PASSWORD do ambiente ou de apps/collector-api/.env.dev
 * (o ambiente tem precedência). A senha nunca é impressa.
 *
 * Códigos de saída: 0 sucesso (aviso de profundidade também sai com 0);
 * 2 configuração inválida; 1 o Valkey não respondeu.
 *
 * BullMQ e ioredis vêm de packages/queue (que já os declara). Os nomes das filas
 * são os de packages/queue/src/constants.ts (PUNCHES_QUEUE, POST_PUNCH_QUEUE).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(root, 'apps', 'collector-api', '.env.dev');
const QUEUE_PACKAGE = path.join(root, 'packages', 'queue', 'package.json');

// Mesmos valores de packages/queue/src/constants.ts.
const PUNCHES_QUEUE = 'punches';
const POST_PUNCH_QUEUE = 'post-punch';
const STATES = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused', 'prioritized', 'waiting-children'];
const DEPTH_WARN_DEFAULT = 10000;

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line) => process.stderr.write(`${line}\n`);
const exit = (code) => process.exit(code);

const require = createRequire(QUEUE_PACKAGE);
const { Queue } = require('bullmq');
const Redis = require('ioredis');

/** Lê KEY=VALOR de um .env simples (sem expansão). Não imprime nada. */
function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) return values;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!m) continue;
    values[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const fileEnv = readEnvFile(ENV_FILE);
const get = (key) => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fileEnv[key]);

// ----------------------------------------------------------------- configuração
const rawUrl = get('VALKEY_URL');
if (!rawUrl) {
  err('Configuração inválida: VALKEY_URL ausente. Rode pnpm setup:dev (ou defina no ambiente).');
  exit(2);
}
let url;
try {
  url = new URL(rawUrl);
} catch {
  // Não ecoa o valor: a URL pode ter sido colada com credenciais.
  err('Configuração inválida: VALKEY_URL não é uma URL válida.');
  exit(2);
}
if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
  err('Configuração inválida: VALKEY_URL deve começar com redis:// ou rediss://.');
  exit(2);
}
if (url.password || url.username) {
  err('Configuração inválida: VALKEY_URL não pode ter usuário ou senha. A senha vai em VALKEY_PASSWORD.');
  exit(2);
}

const password = get('VALKEY_PASSWORD');
if (!password || password.includes('TROQUE')) {
  err('Configuração inválida: VALKEY_PASSWORD ausente ou com TROQUE_. Rode pnpm setup:dev.');
  exit(2);
}

const warnRaw = get('POST_PUNCH_DEPTH_WARN') ?? String(DEPTH_WARN_DEFAULT);
if (!/^\d+$/.test(warnRaw)) {
  err('Configuração inválida: POST_PUNCH_DEPTH_WARN deve ser um inteiro não negativo.');
  exit(2);
}
const depthWarn = Number(warnRaw);

const host = url.hostname;
const port = Number(url.port || 6379);
const endpoint = `${host}:${port}`;

// ----------------------------------------------------------------- consulta
const redis = new Redis({
  host,
  port,
  password,
  tls: url.protocol === 'rediss:' ? {} : undefined,
  connectTimeout: 3000,
  commandTimeout: 5000,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
});
// Erros de conexão são tratados abaixo; sem listener o ioredis só registra no console.
redis.on('error', () => undefined);

// O BullMQ emite os próprios erros de conexão: tratados aqui para não poluir a saída.
const queues = [PUNCHES_QUEUE, POST_PUNCH_QUEUE].map((name) => {
  const queue = new Queue(name, { connection: redis });
  queue.on('error', () => undefined);
  return queue;
});

async function main() {
  try {
    // Sem connect() explícito: o BullMQ já abriu a conexão ao criar as filas.
    await redis.ping();
  } catch (e) {
    // Só o código do erro: a mensagem do ioredis pode trazer detalhes de conexão.
    err(`Valkey não respondeu em ${endpoint} (${e?.code ?? e?.name ?? 'erro'}).`);
    return 1;
  }
  out(`Valkey respondeu em ${endpoint}.`);

  const counts = {};
  try {
    for (const [i, name] of [PUNCHES_QUEUE, POST_PUNCH_QUEUE].entries()) {
      counts[name] = await queues[i].getJobCounts(...STATES);
    }
  } catch (e) {
    err(`Valkey não respondeu ao consultar as filas (${e?.code ?? e?.name ?? 'erro'}).`);
    return 1;
  }

  for (const name of [PUNCHES_QUEUE, POST_PUNCH_QUEUE]) {
    out('');
    out(`Fila ${name}:`);
    for (const state of STATES) {
      out(`  ${state.padEnd(16)} ${counts[name][state] ?? 0}`);
    }
  }

  const post = counts[POST_PUNCH_QUEUE];
  const depth = (post.waiting ?? 0) + (post.delayed ?? 0) + (post.active ?? 0);
  out('');
  out(`Profundidade da post-punch (waiting + delayed + active): ${depth} (aviso acima de ${depthWarn})`);
  if (depth > depthWarn) {
    out(`AVISO: a post-punch passou de ${depthWarn} jobs. Sem consumidor, cada batida gera 3 jobs (docs/SPEC-nsr-fila.md §11).`);
  }
  return 0;
}

let code = 1;
try {
  code = await main();
} finally {
  await Promise.allSettled(queues.map((q) => q.close()));
  redis.disconnect();
}
exit(code);
