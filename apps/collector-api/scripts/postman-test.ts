/**
 * pnpm postman:test [-- --real-engine]
 *
 * Roda a coleção do Postman (postman/) com o Newman, localmente:
 *  1. carrega apps/collector-api/.env.dev;
 *  2. sobe o stub da engine em processo (com endpoint de controle) usando a
 *     MASTER_KEY e a ENGINE_API_KEY do .env.dev;
 *  3. sobe a api como processo filho apontando para o stub (porta livre);
 *  4. executa o Newman (cli + junit em newman/) e encerra tudo.
 * Com --real-engine não há stub: a api usa a engine real do .env.dev e os testes
 * de batida rodam em modo tolerante.
 * Usa o Postgres real de dev (compose). A chave de serviço só passa em memória.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import newman from 'newman';
import { startEngineStub, type EngineStub } from '../test/support/engine-stub';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '..');
const repoRoot = path.resolve(packageDir, '../..');
const postmanDir = path.join(repoRoot, 'postman');
const fixturesDir = path.join(postmanDir, 'fixtures');

const args = process.argv.slice(2).filter((a) => a !== '--');
const realEngine = args.includes('--real-engine');

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address !== 'string' ? resolve(address.port) : reject(new Error('sem porta'))));
    });
  });
}

async function waitReady(baseUrl: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('a api encerrou antes de ficar pronta');
    try {
      const res = await fetch(`${baseUrl}/health/ready`);
      if (res.status === 200) return;
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('a api não ficou pronta a tempo');
}

async function main(): Promise<void> {
  const envFile = path.join(packageDir, '.env.dev');
  if (!existsSync(envFile)) fail('apps/collector-api/.env.dev não encontrado (copie de .env.dev.example).');
  const dotenv = parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>;

  const serviceKey = (dotenv.COLLECTOR_SERVICE_KEYS ?? '').split(',').map((k) => k.trim()).find((k) => k.length > 0);
  if (!serviceKey) fail('COLLECTOR_SERVICE_KEYS vazia no .env.dev.');

  // A imagem > 1 MB não é versionada: gera antes de rodar.
  const gen = spawnSync(process.execPath, [path.join(fixturesDir, 'generate.mjs')], { stdio: 'ignore' });
  if (gen.status !== 0) fail('Falha ao gerar as imagens sintéticas (postman/fixtures/generate.mjs).');

  let stub: EngineStub | null = null;
  let child: ChildProcess | null = null;

  try {
    const childEnv: Record<string, string | undefined> = { ...process.env, ...dotenv };
    if (!realEngine) {
      const { MASTER_KEY, ENGINE_API_KEY } = dotenv;
      if (!MASTER_KEY || !ENGINE_API_KEY) fail('MASTER_KEY e ENGINE_API_KEY são necessárias no .env.dev.');
      stub = await startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY, exposeControl: true });
      childEnv.ENGINE_URL = stub.url;
      out(`Stub da engine em ${stub.url} (controle em /__control/*).`);
    } else {
      out(`Engine real: ${dotenv.ENGINE_URL ?? '(ENGINE_URL ausente)'}`);
    }

    const port = await freePort();
    childEnv.PORT = String(port);
    const baseUrl = `http://127.0.0.1:${port}`;
    const tail: string[] = [];
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: packageDir,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer) => {
        tail.push(...chunk.toString('utf8').split('\n').filter(Boolean));
        if (tail.length > 30) tail.splice(0, tail.length - 30);
      });
    }
    try {
      await waitReady(baseUrl, child, 30_000);
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : 'falha ao subir a api'}\n`);
      process.stderr.write(`Últimas linhas da api:\n${tail.join('\n')}\n`);
      return;
    }
    out(`api do coletor em ${baseUrl}`);

    mkdirSync(path.join(repoRoot, 'newman'), { recursive: true });
    process.exitCode = await new Promise<number>((resolve) => {
      newman.run(
        {
          collection: path.join(postmanDir, 'genus-collector.postman_collection.json'),
          environment: path.join(postmanDir, 'environments', 'dev.postman_environment.json'),
          envVar: [
            { key: 'baseUrl', value: baseUrl },
            { key: 'serviceKey', value: serviceKey },
            { key: 'stubControlUrl', value: stub ? stub.url : '' },
          ],
          workingDir: fixturesDir,
          insecureFileRead: false,
          reporters: ['cli', 'junit'],
          reporter: { junit: { export: path.join(repoRoot, 'newman', 'collector-junit.xml') } },
        },
        (err, summary) => {
          if (err) {
            process.stderr.write(`Newman falhou: ${err.message}\n`);
            resolve(1);
            return;
          }
          resolve(summary.run.failures.length > 0 ? 1 : 0);
        },
      );
    });
    out(`Relatório JUnit: newman/collector-junit.xml`);
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((r) => setTimeout(r, 300));
    }
    if (stub) await stub.close();
  }
  process.exit(process.exitCode ?? 1);
}

main().catch((err: unknown) => {
  process.stderr.write(`Erro: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
