/**
 * pnpm dev:enroll-fake [-- --photos 3] [--fakes 50]
 *
 * Monta a galeria de candidatos de desenvolvimento em dev-data/gallery.json:
 *
 * - Pessoas REAIS: cada SUBPASTA de dev-data/faces/ é uma pessoa (nome da pasta =
 *   nome exibido). O script sorteia `--photos` fotos (padrão 3, máx. 5), manda à
 *   engine (/embeddings/register faz a média e renormaliza) e recebe o embedding
 *   já cifrado com a DEK da conta. As fotos NÃO sorteadas são copiadas para
 *   dev-data/probes/<pessoa>/: são as imagens para testar a batida (a engine
 *   nunca as viu). Um arquivo solto em dev-data/faces/ também vale como pessoa
 *   (uma foto só).
 * - Pessoas FICTÍCIAS: `--fakes` (padrão 50) candidatos com CPF válido e
 *   embedding sintético aleatório, cifrados com a mesma DEK. Servem de
 *   "multidão" para a comparação 1:N.
 *
 * A DEK é a DEK de dev derivada da MASTER_KEY (estável), e o cache de embeddings
 * da engine é invalidado para cada pessoa gravada: recadastrar não deixa vetor
 * velho na memória da engine.
 *
 * NUNCA versionar dev-data/ (rostos e embeddings). Não imprime chaves nem embeddings.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptDek, encryptEmbedding, engineRegisterResponseSchema } from '@genus/shared';
import { generateFakeCpf } from '../src/candidates/cpf';
import {
  deriveDevDek,
  fakeName,
  randomUnitVector,
  type GalleryFile,
} from '../src/candidates/fake-candidate-provider';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '..');
const repoRoot = path.resolve(packageDir, '../..');
const facesDir = path.join(repoRoot, 'dev-data', 'faces');
const probesDir = path.join(repoRoot, 'dev-data', 'probes');
const FIRST_REAL_EMPLOYEE_ID = 1001;
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const out = (line = ''): void => void process.stdout.write(`${line}\n`);
function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function option(name: string, fallback: number, min: number, max: number): number {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n < min || n > max) fail(`${name} deve ser inteiro entre ${min} e ${max}.`);
  return n;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.includes('TROQUE')) fail(`${name} ausente em apps/collector-api/.env.dev (rode pnpm setup:dev).`);
  return value;
}

const isImage = (f: string): boolean => path.extname(f).toLowerCase() in MIME;

/** Sorteio sem reposição (Fisher-Yates com randomInt). */
function pick<T>(items: T[], n: number): { chosen: T[]; rest: T[] } {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return { chosen: a.slice(0, n), rest: a.slice(n) };
}

interface PersonSource {
  name: string;
  photos: string[]; // caminhos absolutos
}

function listPeople(): PersonSource[] {
  if (!existsSync(facesDir)) return [];
  const people: PersonSource[] = [];
  for (const entry of readdirSync(facesDir).sort()) {
    const full = path.join(facesDir, entry);
    if (statSync(full).isDirectory()) {
      const photos = readdirSync(full).filter(isImage).sort().map((f) => path.join(full, f));
      if (photos.length > 0) people.push({ name: entry, photos });
    } else if (isImage(entry)) {
      people.push({ name: path.basename(entry, path.extname(entry)), photos: [full] });
    }
  }
  return people;
}

async function main(): Promise<void> {
  const photosPerPerson = option('--photos', 3, 1, 5);
  const fakes = option('--fakes', 50, 0, 239);

  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const apiKey = requireEnv('ENGINE_API_KEY');
  const masterKey = requireEnv('MASTER_KEY');
  const tenantId = process.env.DEV_TENANT_ID ?? '1';
  const galleryPath = path.resolve(packageDir, process.env.DEV_GALLERY_PATH ?? '../../dev-data/gallery.json');

  const sources = listPeople();
  if (sources.length === 0) {
    out('Nenhuma foto em dev-data/faces/. Crie uma pasta por pessoa com as fotos dela, por exemplo:');
    out('  dev-data/faces/otavio/1.jpg, 2.jpg, ...');
    out('Depois rode de novo: pnpm dev:enroll-fake');
    out('(dev-data/ está no .gitignore: rostos nunca são versionados.)');
    if (fakes === 0) return;
    out(`Seguindo só com ${fakes} candidatos fictícios.`);
  }

  try {
    const res = await fetch(`${engineUrl}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    fail(`Engine inacessível em ${engineUrl} (${err instanceof Error ? err.message : String(err)}). Suba o compose com --profile dev.`);
  }

  const dek = deriveDevDek(masterKey, tenantId);
  const tenantDek = encryptDek(dek, masterKey);
  const people: GalleryFile['people'] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  const probes: string[] = [];

  for (const [i, src] of sources.entries()) {
    const employeeId = FIRST_REAL_EMPLOYEE_ID + i;
    const { chosen, rest } = pick(src.photos, Math.min(photosPerPerson, src.photos.length));
    try {
      const form = new FormData();
      form.append('tenant_id', tenantId);
      form.append('person_id', String(employeeId));
      for (const file of chosen) {
        const bytes = readFileSync(file);
        form.append('files', new Blob([new Uint8Array(bytes)], { type: MIME[path.extname(file).toLowerCase()] }), path.basename(file));
      }
      form.append('dek_ct', tenantDek.ciphertextHex);
      form.append('dek_iv', tenantDek.ivHex);
      form.append('dek_tag', tenantDek.tagHex);
      form.append('dek_key_version', String(tenantDek.keyVersion));
      const res = await fetch(`${engineUrl}/embeddings/register`, { method: 'POST', headers: { 'X-API-Key': apiKey }, body: form });
      const text = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${detailOf(text)}`);
      const reg = engineRegisterResponseSchema.parse(JSON.parse(text));
      people.push({
        employeeId,
        cpf: generateFakeCpf(employeeId),
        displayName: src.name,
        embedding: { ivHex: reg.embedding_iv, tagHex: reg.embedding_tag, ciphertextHex: reg.embedding_ct, keyVersion: 1 },
      });
      out(`${src.name} (colaborador ${employeeId}): embedding de ${reg.images_processed} foto(s): ${chosen.map((f) => path.basename(f)).join(', ')}`);
      if (reg.images_processed < chosen.length) out('  aviso: a engine não achou rosto em alguma das fotos sorteadas.');

      // Fotos que a engine nunca viu: servem para testar a batida.
      const probeDir = path.join(probesDir, src.name);
      mkdirSync(probeDir, { recursive: true });
      for (const file of rest) {
        copyFileSync(file, path.join(probeDir, path.basename(file)));
        probes.push(path.relative(repoRoot, path.join(probeDir, path.basename(file))).replaceAll('\\', '/'));
      }
    } catch (err) {
      failed.push({ name: src.name, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  for (let i = 1; i <= fakes; i++) {
    people.push({
      employeeId: i,
      cpf: generateFakeCpf(i),
      displayName: fakeName(i),
      embedding: encryptEmbedding(randomUnitVector(), dek),
    });
  }

  // O cache de embeddings da engine não tem TTL: invalida cada pessoa gravada.
  for (const p of people) {
    await fetch(`${engineUrl}/embeddings/${encodeURIComponent(tenantId)}/${p.employeeId}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': apiKey },
    }).catch(() => undefined);
  }

  const gallery: GalleryFile = { version: 1, tenantId, tenantDek, people };
  mkdirSync(path.dirname(galleryPath), { recursive: true });
  writeFileSync(galleryPath, JSON.stringify(gallery, null, 2));

  const real = people.length - fakes;
  out();
  out(`Galeria gravada em ${path.relative(repoRoot, galleryPath)}: ${real} pessoa(s) real(is) + ${fakes} fictícia(s) = ${people.length} candidatos.`);
  for (const f of failed) out(`  FALHOU ${f.name}: ${f.reason}`);
  if (probes.length > 0) {
    // Nome fixo para a request "Rosto real" do Postman.
    const fixed = path.join(probesDir, 'proxima-batida.jpg');
    copyFileSync(path.join(repoRoot, probes[0] as string), fixed);
    out();
    out(`Foto de teste para o Postman (pasta "Rosto real"): dev-data/probes/proxima-batida.jpg (cópia de ${probes[0]})`);
    out('Fotos para testar a batida (não usadas no cadastro):');
    for (const p of probes) out(`  ${p}`);
    out();
    out('Reinicie a api (pnpm dev) para carregar a galeria e teste:');
    out(`  pnpm dev:punch -- --image ${probes[0]}`);
  }
  if (sources.length > 0 && real === 0) process.exitCode = 1;
}

function detailOf(text: string): string {
  try {
    const d = (JSON.parse(text) as { detail?: unknown }).detail;
    return typeof d === 'string' ? d : 'sem detalhe';
  } catch {
    return 'resposta não JSON';
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Erro: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
