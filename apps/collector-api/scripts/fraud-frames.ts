/**
 * Lista e decifra as imagens de tentativa de fraude de UMA conta. Dado biométrico:
 * só para quem responde pela apuração; apague a saída decifrada depois do uso.
 *
 *   pnpm fraud:frames --tenant <id> [--date AAAA-MM-DD]       # lista
 *   pnpm fraud:frames --tenant <id> --out <pasta>             # lista e decifra
 *
 * Lê MASTER_KEY e FRAUD_FRAMES_DIR do ambiente (em dev, de apps/collector-api/.env.dev).
 * No Docker: docker compose exec collector-api node_modules/.bin/tsx scripts/fraud-frames.ts
 * --tenant <id> --out /tmp/fraudes
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptFraudFrame, type FraudFrameMetadata } from '../src/modules/punches/fraud-frame-store';

const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));

const out = (line: string): void => void process.stdout.write(`${line}\n`);
function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const tenant = opt('--tenant');
if (!tenant || !/^[1-9]\d*$/.test(tenant)) fail('Informe --tenant <id da conta>.');
const date = opt('--date');
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('--date deve ser AAAA-MM-DD.');
const outDir = opt('--out');
const masterKey = process.env.MASTER_KEY;
if (outDir && !masterKey) fail('MASTER_KEY ausente no ambiente.');

const root = path.join(path.resolve(APP_ROOT, process.env.FRAUD_FRAMES_DIR || 'data/fraudes'), tenant);
const days = date ? [date] : (await readdir(root).catch(() => [] as string[])).sort();
let count = 0;
for (const day of days) {
  const files = await readdir(path.join(root, day)).catch(() => [] as string[]);
  for (const name of files.filter((f) => f.endsWith('.json')).sort()) {
    const id = name.slice(0, -'.json'.length);
    const base = path.join(root, day, id);
    const meta = JSON.parse(await readFile(`${base}.json`, 'utf8')) as FraudFrameMetadata;
    count++;
    out(
      `${day}/${id} capturedAt=${meta.capturedAt} establishmentId=${meta.establishmentId} livenessScore=${meta.livenessScore ?? '-'} traceId=${meta.traceId}`,
    );
    if (outDir && masterKey) {
      const target = path.resolve(outDir, tenant, day);
      await mkdir(target, { recursive: true, mode: 0o700 });
      const image = decryptFraudFrame(await readFile(`${base}.jpg.enc`), masterKey);
      const extension = meta.mime === 'image/png' ? 'png' : 'jpg';
      await writeFile(path.join(target, `${id}.${extension}`), image, { mode: 0o600 });
    }
  }
}
out(`${count} imagem(ns)${outDir ? `, decifrada(s) em ${path.resolve(outDir, tenant)}` : ''}.`);
