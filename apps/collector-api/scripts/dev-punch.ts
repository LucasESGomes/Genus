/**
 * pnpm dev:punch [-- --image caminho] [--sequence N] [--captured-at ISO] [--base-url URL]
 *
 * Faz UMA batida contra a api que já está rodando (pnpm dev) e mostra a
 * resposta e o Server-Timing. A chave de serviço vem de apps/collector-api/.env.dev
 * (nunca é impressa). Sem --image, usa a primeira foto de dev-data/probes/
 * (gerada por pnpm dev:enroll-fake).
 * Repetir com o mesmo --sequence testa a idempotência (mesmo receiptId).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const probesDir = path.join(repoRoot, 'dev-data', 'probes');
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const out = (line = ''): void => void process.stdout.write(`${line}\n`);
function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

function firstProbe(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const found = firstProbe(full);
      if (found) return found;
    } else if (path.extname(entry).toLowerCase() in MIME) {
      return full;
    }
  }
  return undefined;
}

async function main(): Promise<void> {
  const key = process.env.COLLECTOR_SERVICE_KEYS?.split(',')[0]?.trim();
  if (!key || key.includes('TROQUE')) fail('COLLECTOR_SERVICE_KEYS ausente em apps/collector-api/.env.dev (rode pnpm setup:dev).');
  const baseUrl = (opt('--base-url') ?? `http://localhost:${process.env.PORT ?? '3001'}`).replace(/\/+$/, '');

  const imageArg = opt('--image');
  const image = imageArg ? path.resolve(repoRoot, imageArg) : firstProbe(probesDir);
  if (!image) fail('Sem imagem: passe --image <arquivo> ou rode pnpm dev:enroll-fake para gerar dev-data/probes/.');
  if (!existsSync(image)) fail(`Arquivo não encontrado: ${image}`);
  const mime = MIME[path.extname(image).toLowerCase()];
  if (!mime) fail('A imagem precisa ser .jpg, .jpeg ou .png.');

  const sequence = opt('--sequence') ?? String(Date.now());
  const capturedAt = opt('--captured-at') ?? new Date().toISOString();

  const form = new FormData();
  form.append('image', new Blob([new Uint8Array(readFileSync(image))], { type: mime }), path.basename(image));
  form.append('deviceSequence', sequence);
  form.append('capturedAt', capturedAt);

  out(`POST ${baseUrl}/coletor/batidas`);
  out(`  imagem: ${path.relative(repoRoot, image)}  deviceSequence: ${sequence}  capturedAt: ${capturedAt}`);
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/coletor/batidas`, { method: 'POST', headers: { 'X-Service-Key': key }, body: form });
  } catch (err) {
    fail(`A api não respondeu em ${baseUrl} (${err instanceof Error ? err.message : String(err)}). Ela está rodando? (pnpm dev)`);
  }
  const ms = performance.now() - started;
  const body = await res.text();
  out(`HTTP ${res.status} em ${ms.toFixed(1)} ms`);
  out(`Server-Timing: ${res.headers.get('server-timing') ?? '(ausente)'}`);
  try {
    out(JSON.stringify(JSON.parse(body), null, 2));
  } catch {
    out(body);
  }
}

main().catch((err: unknown) => fail(`Erro: ${err instanceof Error ? err.message : String(err)}`));
