/**
 * pnpm bench:punch -- --n 50 --concurrency 4 [--image caminho] [--base-url http://localhost:3001]
 *
 * Dispara N batidas contra a api JÁ rodando e imprime min/p50/p95/p99/máx dos
 * tempos do cliente e do servidor (meta.timings ou Server-Timing), das etapas da
 * engine, a taxa de registered/fallback_required e a contagem de erros.
 * Chave de serviço: COLLECTOR_SERVICE_KEY no ambiente ou a primeira de
 * COLLECTOR_SERVICE_KEYS do .env.dev. Nunca é impressa.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { deflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '..');

function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function parseArgs(argv: string[]): { n: number; concurrency: number; image?: string; baseUrl: string } {
  const values = new Map<string, string>();
  const list = argv.filter((a) => a !== '--');
  for (let i = 0; i < list.length; i++) {
    const a = list[i] as string;
    if (a.startsWith('--')) {
      const next = list[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        values.set(a.slice(2), next);
        i++;
      } else values.set(a.slice(2), 'true');
    }
  }
  const positive = (name: string, fallback: number): number => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const v = Number(raw);
    if (!Number.isInteger(v) || v <= 0) fail(`--${name} deve ser um inteiro maior que zero`);
    return v;
  };
  return {
    n: positive('n', 50),
    concurrency: positive('concurrency', 4),
    image: values.get('image'),
    baseUrl: (values.get('base-url') ?? 'http://localhost:3001').replace(/\/+$/, ''),
  };
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG cinza 320x320 sem rosto. */
function syntheticPng(size = 320): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  const rows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1);
    for (let x = 0; x < size; x++) row[x + 1] = Math.floor(((x + y) / (2 * size)) * 255);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function resolveServiceKey(): string {
  const fromEnv = process.env.COLLECTOR_SERVICE_KEY;
  if (fromEnv) return fromEnv;
  const envFile = path.join(packageDir, '.env.dev');
  if (existsSync(envFile)) {
    const dotenv = parseEnv(readFileSync(envFile, 'utf8')) as Record<string, string>;
    const key = (dotenv.COLLECTOR_SERVICE_KEYS ?? '').split(',').map((k) => k.trim()).find((k) => k.length > 0);
    if (key) return key;
  }
  return fail('Chave de serviço não encontrada: defina COLLECTOR_SERVICE_KEY ou COLLECTOR_SERVICE_KEYS no .env.dev.');
}

function parseServerTiming(header: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  if (!header) return result;
  for (const entry of header.split(',')) {
    const m = /^\s*([\w-]+)\s*;\s*dur=([\d.]+)/.exec(entry);
    if (m) result[m[1] as string] = Number(m[2]);
  }
  return result;
}

interface Sample {
  clientMs: number;
  ok: boolean;
  outcome: string | null;
  reason: string | null;
  server: Record<string, number>;
  stages: Record<string, number> | null;
  usedMeta: boolean;
  error: string | null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}

function statsRow(label: string, values: number[]): string {
  const sorted = [...values].sort((a, b) => a - b);
  const f = (v: number): string => (Number.isNaN(v) ? '-' : v.toFixed(1)).padStart(9);
  return `${label.padEnd(26)}${String(sorted.length).padStart(5)}${f(sorted[0] ?? NaN)}${f(percentile(sorted, 50))}${f(percentile(sorted, 95))}${f(percentile(sorted, 99))}${f(sorted[sorted.length - 1] ?? NaN)}`;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const serviceKey = resolveServiceKey();

  let image: Buffer;
  let mime: string;
  let fileName: string;
  if (opts.image) {
    if (!existsSync(opts.image)) fail(`Imagem não encontrada: ${opts.image}`);
    image = readFileSync(opts.image);
    const ext = path.extname(opts.image).toLowerCase();
    mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    fileName = path.basename(opts.image);
  } else {
    image = syntheticPng();
    mime = 'image/png';
    fileName = 'synthetic.png';
    out('AVISO: sem --image, usando um PNG sintético SEM rosto. Isso mede só decodificação + detecção');
    out('       (a engine sai cedo com no_face). Para o pipeline completo, use uma foto de dev-data/faces/');
    out('       (git-ignorado) depois de rodar `pnpm dev:enroll-fake`.');
    out();
  }
  const imageBytes = new Uint8Array(image);

  const startSeq = Date.now() * 1000;
  const samples: Sample[] = [];
  let next = 0;

  async function one(i: number): Promise<void> {
    const form = new FormData();
    form.append('image', new Blob([imageBytes], { type: mime }), fileName);
    form.append('deviceSequence', String(startSeq + i));
    form.append('capturedAt', new Date().toISOString());
    const t0 = performance.now();
    try {
      const res = await fetch(`${opts.baseUrl}/coletor/batidas`, {
        method: 'POST',
        headers: { 'X-Service-Key': serviceKey },
        body: form,
      });
      const text = await res.text();
      const clientMs = performance.now() - t0;
      const sample: Sample = {
        clientMs, ok: res.status === 200, outcome: null, reason: null,
        server: parseServerTiming(res.headers.get('server-timing')), stages: null, usedMeta: false,
        error: res.status === 200 ? null : `HTTP ${res.status}`,
      };
      if (res.status === 200) {
        try {
          const json = JSON.parse(text) as {
            data?: { outcome?: string; reason?: string };
            meta?: { timings?: Record<string, unknown> };
          };
          sample.outcome = json.data?.outcome ?? null;
          sample.reason = json.data?.reason ?? null;
          const t = json.meta?.timings;
          if (t) {
            sample.usedMeta = true;
            const pick = (k: string, name: string): void => {
              const v = t[k];
              if (typeof v === 'number') sample.server[name] = v;
            };
            pick('total', 'total');
            pick('engineRoundTrip', 'engine');
            pick('engineProcessing', 'engine-processing');
            const stages = t.engineStages;
            if (stages && typeof stages === 'object') sample.stages = stages as Record<string, number>;
          }
        } catch {
          sample.ok = false;
          sample.error = 'corpo não é JSON';
        }
      }
      samples.push(sample);
    } catch (err) {
      samples.push({
        clientMs: performance.now() - t0, ok: false, outcome: null, reason: null, server: {}, stages: null, usedMeta: false,
        error: err instanceof Error ? err.message : 'erro de rede',
      });
    }
  }

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= opts.n) return;
      await one(i);
    }
  }

  out(`Disparando ${opts.n} batidas, concorrência ${opts.concurrency}, em ${opts.baseUrl}`);
  const wall0 = performance.now();
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, opts.n) }, () => worker()));
  const wallMs = performance.now() - wall0;

  const okSamples = samples.filter((s) => s.ok);
  out(`Tempo de parede: ${(wallMs / 1000).toFixed(2)} s  |  vazão: ${(samples.length / (wallMs / 1000)).toFixed(1)} req/s`);
  out();
  out(`${'Medida (ms)'.padEnd(26)}${'n'.padStart(5)}${'min'.padStart(9)}${'p50'.padStart(9)}${'p95'.padStart(9)}${'p99'.padStart(9)}${'max'.padStart(9)}`);
  out('-'.repeat(76));
  out(statsRow('cliente (ida e volta)', samples.map((s) => s.clientMs)));
  for (const [label, key] of [
    ['servidor total', 'total'],
    ['validate', 'validate'],
    ['candidates', 'candidates'],
    ['engine (ida e volta)', 'engine'],
    ['engine-processing', 'engine-processing'],
    ['db', 'db'],
  ] as const) {
    const values = okSamples.map((s) => s.server[key]).filter((v): v is number => typeof v === 'number');
    if (values.length > 0) out(statsRow(label, values));
  }

  const stageNames = new Set<string>();
  for (const s of okSamples) for (const k of Object.keys(s.stages ?? {})) if (k.endsWith('_ms')) stageNames.add(k);
  if (stageNames.size > 0) {
    out();
    out('Etapas da engine (meta.timings.engineStages):');
    for (const name of [...stageNames].sort()) {
      const values = okSamples.map((s) => s.stages?.[name]).filter((v): v is number => typeof v === 'number');
      out(statsRow(`  ${name}`, values));
    }
  } else if (okSamples.length > 0 && !okSamples.some((s) => s.usedMeta)) {
    out();
    out('AVISO: meta.timings ausente (usei o Server-Timing). As etapas da engine exigem EXPOSE_TIMINGS=true na api.');
  } else if (okSamples.length > 0) {
    out();
    out('Obs.: a engine não informou etapas (engineStages vazio) neste cenário.');
  }

  const registered = okSamples.filter((s) => s.outcome === 'registered').length;
  const fallbacks = okSamples.filter((s) => s.outcome === 'fallback_required');
  const reasons = new Map<string, number>();
  for (const s of fallbacks) reasons.set(s.reason ?? '?', (reasons.get(s.reason ?? '?') ?? 0) + 1);
  const pct = (v: number): string => (samples.length === 0 ? '0' : ((v / samples.length) * 100).toFixed(1));
  out();
  out(`registered:        ${registered} (${pct(registered)}%)`);
  out(`fallback_required: ${fallbacks.length} (${pct(fallbacks.length)}%)`);
  for (const [reason, count] of [...reasons.entries()].sort()) out(`  - ${reason}: ${count}`);
  const errors = samples.filter((s) => !s.ok);
  out(`erros (HTTP != 200 ou rede): ${errors.length}`);
  const errKinds = new Map<string, number>();
  for (const e of errors) errKinds.set(e.error ?? '?', (errKinds.get(e.error ?? '?') ?? 0) + 1);
  for (const [kind, count] of [...errKinds.entries()].sort()) out(`  - ${kind}: ${count}`);
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`Erro: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
