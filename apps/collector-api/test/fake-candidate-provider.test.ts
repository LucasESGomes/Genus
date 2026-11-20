import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createLogger,
  decryptDek,
  decryptEmbedding,
  encryptDek,
  encryptEmbedding,
  generateDek,
  type DeviceContext,
} from '@genus/shared';
import { isValidCpf } from '../src/candidates/cpf';
import { deriveDevDek, FakeCandidateProvider, randomUnitVector, type GalleryFile } from '../src/candidates/fake-candidate-provider';

const logger = createLogger({ level: 'silent', service: 'test' });
const MASTER = randomBytes(32).toString('hex');
const ctx: DeviceContext = { tenantId: 1, establishmentId: 1, deviceId: 1 };
const tmp = mkdtempSync(path.join(tmpdir(), 'genus-gallery-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function writeGallery(masterKeyHex: string, name: string): { file: string; dekHex: string } {
  const dek = generateDek();
  const gallery: GalleryFile = {
    version: 1,
    tenantId: '1',
    tenantDek: encryptDek(dek, masterKeyHex),
    people: [
      { employeeId: 1001, cpf: '52998224725', displayName: 'Real Um', embedding: encryptEmbedding(randomUnitVector(), dek) },
      { employeeId: 1002, cpf: '11144477735', displayName: 'Real Dois', embedding: encryptEmbedding(randomUnitVector(), dek) },
    ],
  };
  const file = path.join(tmp, name);
  writeFileSync(file, JSON.stringify(gallery));
  return { file, dekHex: dek.toString('hex') };
}

describe('FakeCandidateProvider', () => {
  it('gera N candidatos com CPFs válidos e distintos e DEK que decifra', async () => {
    const provider = new FakeCandidateProvider({ masterKeyHex: MASTER, count: 25, logger });
    const set = await provider.getCandidates(ctx);
    expect(set.candidates).toHaveLength(25);
    const cpfs = set.candidates.map((c) => c.cpf);
    expect(cpfs.every(isValidCpf)).toBe(true);
    expect(new Set(cpfs).size).toBe(25);
    expect(new Set(set.candidates.map((c) => c.employeeId)).size).toBe(25);
    const dek = decryptDek(set.tenantDek, MASTER);
    for (const c of set.candidates) expect(decryptEmbedding(c.embedding, dek)).toHaveLength(512);
    expect(await provider.getCandidates({ ...ctx, tenantId: 9 })).toBe(set);
  });

  it('usa 20 candidatos por padrão', async () => {
    const set = await new FakeCandidateProvider({ masterKeyHex: MASTER, logger }).getCandidates(ctx);
    expect(set.candidates).toHaveLength(20);
  });

  it('carrega a galeria de arquivo e completa com fictícios', async () => {
    const { file, dekHex } = writeGallery(MASTER, 'ok.json');
    const set = await new FakeCandidateProvider({ masterKeyHex: MASTER, count: 5, galleryPath: file, logger }).getCandidates(ctx);
    expect(set.candidates).toHaveLength(5);
    expect(set.candidates.slice(0, 2).map((c) => c.displayName)).toEqual(['Real Um', 'Real Dois']);
    const dek = decryptDek(set.tenantDek, MASTER);
    expect(dek.toString('hex')).toBe(dekHex);
    for (const c of set.candidates) decryptEmbedding(c.embedding, dek);
  });

  it('galeria feita com outra MASTER_KEY falha com mensagem clara', () => {
    const { file } = writeGallery(randomBytes(32).toString('hex'), 'other.json');
    expect(() => new FakeCandidateProvider({ masterKeyHex: MASTER, galleryPath: file, logger })).toThrow(
      /pnpm dev:enroll-fake de novo/,
    );
  });

  it('galeria inexistente é ignorada', async () => {
    const set = await new FakeCandidateProvider({
      masterKeyHex: MASTER, count: 3, galleryPath: path.join(tmp, 'nao-existe.json'), logger,
    }).getCandidates(ctx);
    expect(set.candidates).toHaveLength(3);
  });
});

describe('DEK de dev estável (engine guarda a DEK por tenant em cache por 1 h)', () => {
  it('sem galeria, dois starts da api usam a MESMA DEK: embeddings de um start decifram com a do outro', async () => {
    const a = await new FakeCandidateProvider({ masterKeyHex: MASTER, count: 3, logger }).getCandidates(ctx);
    const b = await new FakeCandidateProvider({ masterKeyHex: MASTER, count: 3, logger }).getCandidates(ctx);
    const dekA = decryptDek(a.tenantDek, MASTER);
    const dekB = decryptDek(b.tenantDek, MASTER);
    expect(dekA.equals(dekB)).toBe(true);
    expect(dekA.equals(deriveDevDek(MASTER, '1'))).toBe(true);
    const first = b.candidates[0];
    expect(first).toBeDefined();
    expect(decryptEmbedding(first!.embedding, dekA)).toHaveLength(512);
  });

  it('a DEK derivada muda com a conta e com a MASTER_KEY', () => {
    expect(deriveDevDek(MASTER, '1').equals(deriveDevDek(MASTER, '2'))).toBe(false);
    expect(deriveDevDek(MASTER, '1').equals(deriveDevDek(randomBytes(32).toString('hex'), '1'))).toBe(false);
    expect(deriveDevDek(MASTER, '1')).toHaveLength(32);
  });
});
