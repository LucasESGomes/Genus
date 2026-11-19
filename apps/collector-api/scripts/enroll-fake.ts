/**
 * pnpm dev:enroll-fake
 *
 * Cadastra rostos REAIS de teste na engine (/embeddings/register) e grava
 * dev-data/gallery.json. Um arquivo de dev-data/faces/ = uma pessoa.
 * NUNCA versionar dev-data/ (rostos e embeddings). Não imprime chaves nem embeddings.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decryptDek,
  encryptDek,
  engineRegisterResponseSchema,
  generateDek,
  type EncryptedDek,
} from '@genus/shared';
import { generateFakeCpf } from '../src/candidates/cpf';
import { galleryFileSchema, type GalleryFile } from '../src/candidates/fake-candidate-provider';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(here, '..');
const repoRoot = path.resolve(packageDir, '../..');
const facesDir = path.join(repoRoot, 'dev-data', 'faces');
const FIRST_EMPLOYEE_ID = 1001;
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function fail(line: string): never {
  process.stderr.write(`${line}\n`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`Variável de ambiente ${name} ausente (veja apps/collector-api/.env.dev.example).`);
  return value;
}

async function main(): Promise<void> {
  const files = existsSync(facesDir)
    ? readdirSync(facesDir)
        .filter((f) => path.extname(f).toLowerCase() in MIME)
        .sort()
    : [];
  if (files.length === 0) {
    out('Nenhuma foto encontrada em dev-data/faces/.');
    out('Coloque uma foto por pessoa (.jpg, .jpeg ou .png) nessa pasta: o nome do arquivo sem extensão vira o nome da pessoa.');
    out('Depois rode: pnpm dev:enroll-fake');
    out('(dev-data/ está no .gitignore: rostos nunca são versionados.)');
    return;
  }

  const engineUrl = requireEnv('ENGINE_URL').replace(/\/+$/, '');
  const apiKey = requireEnv('ENGINE_API_KEY');
  const masterKey = requireEnv('MASTER_KEY');
  const tenantId = process.env.DEV_TENANT_ID ?? '1';
  const galleryPath = path.resolve(packageDir, process.env.DEV_GALLERY_PATH ?? '../../dev-data/gallery.json');

  // Reaproveita a DEK da galeria existente se ainda decifra com a MASTER_KEY atual
  // (a engine guarda a DEK por tenant por 1 h: trocar a DEK nesse intervalo quebra o reconhecimento).
  let tenantDek: EncryptedDek | null = null;
  if (existsSync(galleryPath)) {
    try {
      const old = galleryFileSchema.parse(JSON.parse(readFileSync(galleryPath, 'utf8')));
      decryptDek(old.tenantDek, masterKey);
      tenantDek = old.tenantDek;
      out('Reaproveitando a DEK da galeria existente.');
    } catch {
      out('Galeria existente ilegível ou de outra MASTER_KEY: gerando DEK nova.');
    }
  }
  tenantDek ??= encryptDek(generateDek(), masterKey);

  const people: GalleryFile['people'] = [];
  const failed: Array<{ file: string; reason: string }> = [];

  for (const [i, file] of files.entries()) {
    const employeeId = FIRST_EMPLOYEE_ID + i;
    const ext = path.extname(file).toLowerCase();
    const displayName = path.basename(file, path.extname(file));
    try {
      const form = new FormData();
      form.append('tenant_id', tenantId);
      form.append('person_id', String(employeeId));
      const bytes = readFileSync(path.join(facesDir, file));
      form.append('files', new Blob([new Uint8Array(bytes)], { type: MIME[ext] }), file);
      form.append('dek_ct', tenantDek.ciphertextHex);
      form.append('dek_iv', tenantDek.ivHex);
      form.append('dek_tag', tenantDek.tagHex);
      form.append('dek_key_version', String(tenantDek.keyVersion));
      const res = await fetch(`${engineUrl}/embeddings/register`, {
        method: 'POST',
        headers: { 'X-API-Key': apiKey },
        body: form,
      });
      const text = await res.text();
      if (res.status !== 200) {
        let detail = `HTTP ${res.status}`;
        try {
          const d = (JSON.parse(text) as { detail?: unknown }).detail;
          if (typeof d === 'string') detail += `: ${d}`;
        } catch {
          // corpo não é JSON; fica só o status
        }
        throw new Error(detail);
      }
      const reg = engineRegisterResponseSchema.parse(JSON.parse(text));
      people.push({
        employeeId,
        cpf: generateFakeCpf(employeeId),
        displayName,
        embedding: {
          ivHex: reg.embedding_iv,
          tagHex: reg.embedding_tag,
          ciphertextHex: reg.embedding_ct,
          keyVersion: 1,
        },
      });
    } catch (err) {
      failed.push({ file, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (people.length > 0) {
    const gallery: GalleryFile = { version: 1, tenantId, tenantDek, people };
    mkdirSync(path.dirname(galleryPath), { recursive: true });
    writeFileSync(galleryPath, JSON.stringify(gallery, null, 2));
  }
  out(`Cadastradas: ${people.length} de ${files.length} pessoa(s).`);
  for (const f of failed) out(`  FALHOU ${f.file}: ${f.reason}`);
  if (people.length > 0) out('Galeria gravada em dev-data/gallery.json.');
  if (people.length === 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`Erro: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
