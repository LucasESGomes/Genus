#!/usr/bin/env node
/**
 * pnpm dev — sobe tudo o que o ambiente de dev precisa com UM comando:
 *
 *   1. preparo (pnpm dev:up): arquivos de ambiente, Postgres + Valkey + engine, papéis do
 *      banco arp e migrations. Idempotente. Pule com `pnpm dev -- --sem-preparo`.
 *   2. três processos, com o log de cada um prefixado:
 *        [api]       api do coletor (http://localhost:3001, tsx watch)
 *        [rep-core]  worker que atribui NSR e grava registros (consome `punches`)
 *        [resgate]   republica entradas e outbox pendentes (apps/jobs)
 *
 * Ctrl+C encerra os três. Se um deles cair, os outros são encerrados e o comando sai com erro.
 * Para depurar um processo isolado continuam valendo: pnpm dev:rep-core e pnpm dev:jobs.
 */
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preparo = !process.argv.includes('--sem-preparo');

const COLORS = { api: '\x1b[36m', 'rep-core': '\x1b[35m', resgate: '\x1b[33m', sistema: '\x1b[32m' };
const RESET = '\x1b[0m';
const log = (name, line) => process.stdout.write(`${COLORS[name] ?? ''}[${name}]${RESET} ${line}\n`);

if (preparo) {
  const r = spawnSync('node', ['scripts/dev-up.mjs'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    log('sistema', 'o preparo falhou; nenhum processo foi iniciado.');
    process.exit(r.status ?? 1);
  }
}

const servicos = [
  { name: 'api', args: ['--filter', '@genus/collector-api', 'dev'] },
  { name: 'rep-core', args: ['--filter', '@genus/rep-core', 'start'] },
  { name: 'resgate', args: ['--filter', '@genus/jobs', 'start'] },
];

const filhos = new Map();
let encerrando = false;

function encerrarTodos() {
  if (encerrando) return;
  encerrando = true;
  for (const [name, child] of filhos) {
    if (process.platform === 'win32') {
      // Mata a árvore inteira (pnpm -> node -> tsx), senão o processo filho fica órfão.
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
    log(name, 'encerrado.');
  }
}

for (const { name, args } of servicos) {
  const child = spawn('pnpm', args, { cwd: root, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  filhos.set(name, child);
  let pendente = { out: '', err: '' };
  const emitir = (kind) => (chunk) => {
    pendente[kind] += chunk.toString();
    const linhas = pendente[kind].split(/\r?\n/);
    pendente[kind] = linhas.pop() ?? '';
    for (const l of linhas) if (l.trim()) log(name, l);
  };
  child.stdout.on('data', emitir('out'));
  child.stderr.on('data', emitir('err'));
  child.on('exit', (code) => {
    if (encerrando) return;
    log('sistema', `${name} saiu (código ${code}). Encerrando os demais.`);
    encerrarTodos();
    process.exitCode = code || 1;
  });
}

log('sistema', 'api em http://localhost:3001 (Swagger em /docs). Ctrl+C encerra tudo.');

process.on('SIGINT', () => { encerrarTodos(); process.exit(0); });
process.on('SIGTERM', () => { encerrarTodos(); process.exit(0); });
