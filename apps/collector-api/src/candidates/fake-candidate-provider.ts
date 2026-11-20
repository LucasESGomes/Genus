/**
 * Candidatos provisórios (desenvolvimento e homologação). Candidatos SEMPRE vêm
 * do servidor, nunca do corpo da requisição.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  decryptDek,
  decryptEmbedding,
  encryptDek,
  encryptEmbedding,
  l2Normalize,
  maskCpf,
  type Candidate,
  type CandidateProvider,
  type CandidateSet,
  type DeviceContext,
  type Logger,
} from '@genus/shared';
import { z } from 'zod';
import { generateFakeCpf } from './cpf';

const hex = z.string().regex(/^[0-9a-fA-F]*$/);
const encryptedHexShape = {
  ivHex: hex,
  tagHex: hex,
  ciphertextHex: hex,
  keyVersion: z.number().int().positive(),
};

/** Formato de `dev-data/gallery.json` (gerado por `pnpm dev:enroll-fake`). */
export const galleryFileSchema = z.object({
  version: z.literal(1),
  tenantId: z.string(),
  tenantDek: z.object(encryptedHexShape),
  people: z.array(
    z.object({
      employeeId: z.number().int(),
      cpf: z.string().regex(/^\d{11}$/),
      displayName: z.string(),
      embedding: z.object(encryptedHexShape),
    }),
  ),
});
export type GalleryFile = z.infer<typeof galleryFileSchema>;

const FAKE_NAMES = [
  'Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Alves', 'Elisa Rocha',
  'Fábio Nunes', 'Gabriela Dias', 'Henrique Costa', 'Isabela Prado', 'João Pereira',
  'Karina Lopes', 'Lucas Ribeiro', 'Marina Faria', 'Nelson Teixeira', 'Olívia Barros',
  'Paulo Moreira', 'Queila Freitas', 'Rafael Gomes', 'Sabrina Castro', 'Thiago Martins',
];
const FAKE_SURNAMES = ['Souza', 'Lima', 'Mendes', 'Alves', 'Rocha', 'Nunes', 'Dias', 'Costa', 'Prado', 'Pereira'];

/**
 * DEK de desenvolvimento ESTÁVEL por conta, derivada da MASTER_KEY.
 * Motivo: a engine guarda a DEK por tenant em cache por 1 h e, enquanto o cache
 * vale, IGNORA a DEK enviada na requisição. Uma DEK aleatória a cada start da
 * api (ou a cada cadastro) deixaria embeddings cifrados com uma DEK e a engine
 * decifrando com outra: InvalidTag. Só para dev/homolog; em produção a DEK de
 * cada conta é aleatória e fica em `chaves_conta` (banco app).
 */
export function deriveDevDek(masterKeyHex: string, tenantId: string): Buffer {
  return createHmac('sha256', Buffer.from(masterKeyHex, 'hex')).update(`genus/dev-dek/v1/${tenantId}`).digest();
}

/** Nome fictício determinístico (nome + sobrenome) para o candidato `i` (1..N). */
export function fakeName(i: number): string {
  const first = FAKE_NAMES[(i - 1) % FAKE_NAMES.length] ?? 'Pessoa';
  const last = FAKE_SURNAMES[Math.floor((i - 1) / FAKE_NAMES.length) % FAKE_SURNAMES.length] ?? '';
  return `${first.split(' ')[0]} ${last}`.trim();
}

/** Vetor aleatório de 512 dimensões, norma L2 = 1 (embedding sintético). */
export function randomUnitVector(): Float32Array {
  const bytes = randomBytes(512 * 4);
  const v = new Float32Array(512);
  for (let i = 0; i < 512; i++) v[i] = bytes.readUInt32LE(i * 4) / 0x1_0000_0000 - 0.5;
  return l2Normalize(v);
}

export function loadGallery(galleryPath: string): GalleryFile {
  return galleryFileSchema.parse(JSON.parse(readFileSync(galleryPath, 'utf8')));
}

export interface FakeCandidateProviderOptions {
  masterKeyHex: string;
  count?: number;
  galleryPath?: string;
  /** Conta (tenant) da DEK de dev derivada. Padrão '1'. */
  tenantId?: string;
  logger: Logger;
}

export class FakeCandidateProvider implements CandidateProvider {
  private readonly set: CandidateSet;

  constructor(opts: FakeCandidateProviderOptions) {
    const count = opts.count ?? 20;
    let dek: Buffer;
    let tenantDek: CandidateSet['tenantDek'];
    const candidates: Candidate[] = [];

    if (opts.galleryPath && existsSync(opts.galleryPath)) {
      const gallery = loadGallery(opts.galleryPath);
      try {
        dek = decryptDek(gallery.tenantDek, opts.masterKeyHex);
        for (const p of gallery.people) decryptEmbedding(p.embedding, dek);
      } catch {
        throw new Error(
          `Galeria de dev (${opts.galleryPath}) foi feita com outra MASTER_KEY ou está corrompida: rode pnpm dev:enroll-fake de novo`,
        );
      }
      tenantDek = gallery.tenantDek;
      for (const p of gallery.people) candidates.push({ ...p });
      opts.logger.info({ real: candidates.length }, 'candidatos: galeria de dev carregada');
    } else {
      dek = deriveDevDek(opts.masterKeyHex, opts.tenantId ?? '1');
      tenantDek = encryptDek(dek, opts.masterKeyHex);
    }

    const realCount = candidates.length;
    const usedIds = new Set(candidates.map((c) => c.employeeId));
    for (let i = 1; candidates.length < count; i++) {
      if (usedIds.has(i)) continue;
      candidates.push({
        employeeId: i,
        cpf: generateFakeCpf(i),
        displayName: fakeName(i),
        embedding: encryptEmbedding(randomUnitVector(), dek),
      });
    }
    opts.logger.info(
      { total: candidates.length, real: realCount, sampleCpf: candidates[0] ? maskCpf(candidates[0].cpf) : null },
      'candidatos fictícios prontos',
    );
    this.set = { tenantDek, candidates };
  }

  /**
   * O DeviceContext é ignorado nesta versão: devolve sempre o mesmo conjunto.
   * A implementação futura filtra por `ctx.tenantId` e `ctx.establishmentId`
   * (galeria do estabelecimento no banco `app`).
   */
  async getCandidates(_ctx: DeviceContext): Promise<CandidateSet> {
    return this.set;
  }
}
