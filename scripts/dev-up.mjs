#!/usr/bin/env node
/**
 * pnpm dev:up
 *
 * Deixa a INFRAESTRUTURA de dev pronta para rodar os processos Node no host (pnpm dev):
 *   1. pnpm setup:dev (cria/completa o .env da raiz e os .env.dev dos apps);
 *   2. docker compose up -d --wait só da infra: Postgres, Valkey e engine; depois os papéis
 *      e bancos (db-roles) e as migrations do arp (arp-migrate) e do RH (rh-migrate).
 *      A primeira subida da engine baixa os modelos: alguns minutos.
 * As APIs, o rep-core e o resgate NÃO sobem no Docker aqui: rodam no host com `pnpm dev`.
 * Para subir tudo no Docker, use `docker compose up -d` (e não rode `pnpm dev` ao mesmo tempo:
 * as portas 3001 e 3002 são as mesmas).
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

// Serviços da infraestrutura (nomes do docker-compose.yml da raiz). Os migradores saem sozinhos ao terminar.
const infraServices = ['postgres', 'valkey', 'face-engine', 'db-roles', 'arp-migrate', 'rh-migrate'];

run('Arquivos de ambiente', 'node', ['scripts/setup-dev.mjs']);
run(
  'Postgres, Valkey e engine, papéis e migrations (a primeira vez baixa os modelos da engine: alguns minutos)',
  'docker',
  ['compose', 'up', '-d', '--build', '--wait', ...infraServices],
);

out('\nAmbiente pronto. Agora:');
out('  pnpm dev                 # sobe api do coletor, rep-core, resgate e api do RH (Swagger em http://localhost:3001/docs)');
out('  pnpm dev:enroll-fake     # galeria: suas fotos em dev-data/faces/<nome>/ + 50 candidatos fictícios');
out('  pnpm dev:punch           # uma batida com uma foto de dev-data/probes/');
