#!/usr/bin/env node
/**
 * pnpm dev:up
 *
 * Deixa o ambiente de dev pronto para a api do coletor:
 *   1. pnpm setup:dev (cria/completa infra/.env e apps/collector-api/.env.dev);
 *   2. docker compose --profile dev up -d --wait (Postgres + engine + porta 8001);
 *      a primeira subida da engine baixa os modelos: alguns minutos;
 *   3. aplica as migrations do banco arp.
 * Depois: pnpm dev (api) e, em outro terminal, pnpm dev:punch.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (line = '') => process.stdout.write(`${line}\n`);

function run(title, cmd, args) {
  out(`\n==> ${title}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    out(`\nFalhou: ${title}.`);
    process.exit(r.status ?? 1);
  }
}

const compose = ['compose', '-f', 'infra/docker-compose.yml', '--env-file', 'infra/.env', '--profile', 'dev'];

run('Arquivos de ambiente', 'node', ['scripts/setup-dev.mjs']);
run('Postgres e engine (a primeira vez baixa os modelos da engine: alguns minutos)', 'docker', [...compose, 'up', '-d', '--build', '--wait']);
run('Migrations do banco arp', 'pnpm', ['db:migrate:arp']);

out('\nAmbiente pronto. Agora:');
out('  pnpm dev                 # sobe a api em http://localhost:3001 (Swagger em http://localhost:3001/docs)');
out('  pnpm dev:enroll-fake     # galeria: suas fotos em dev-data/faces/<nome>/ + 50 candidatos fictícios');
out('  pnpm dev:punch           # uma batida com uma foto de dev-data/probes/');
