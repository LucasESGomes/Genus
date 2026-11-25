/**
 * Banco `app` mínimo para os testes: papel `genus_coletor_leitura`, schema `rh` com só as colunas
 * que a api do coletor lê, e os GRANTs de verdade (o bloco DO extraído de db/postgres/bootstrap.sh).
 * Reaproveita o container do arp (mesma instância Postgres, como no compose).
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ArpTestDatabase } from '@genus/db-arp';
import { encryptDek, encryptEmbedding, generateDek } from '@genus/shared';
import pg from 'pg';
import { randomUnitVector } from '../../src/candidates/fake-candidate-provider';

export interface AppTestDatabase {
  /** URL do papel `genus_coletor_leitura` (o que a api usa em runtime). */
  readerUrl: string;
  /** Superusuário: semeia dados e contorna os GRANTs. */
  admin: pg.Pool;
  stop(): Promise<void>;
}

const DDL = `
CREATE SCHEMA rh;
CREATE TABLE rh.aparelhos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id BIGINT NOT NULL,
  estabelecimento_id BIGINT NOT NULL,
  nome TEXT NOT NULL DEFAULT 'totem',
  ativo BOOLEAN NOT NULL DEFAULT true,
  chave_hash BYTEA UNIQUE,
  chave_prefixo TEXT,
  limiar_reconhecimento REAL,
  limiar_vivacidade REAL
);
CREATE TABLE rh.colaboradores (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id BIGINT NOT NULL,
  estabelecimento_id BIGINT NOT NULL,
  cpf CHAR(11) NOT NULL,
  nome TEXT NOT NULL,
  pin_hash TEXT NOT NULL DEFAULT 'scrypt$segredo',
  data_desligamento DATE
);
CREATE TABLE rh.chaves_empresa (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id BIGINT NOT NULL,
  empresa_id BIGINT NOT NULL,
  versao_chave INTEGER NOT NULL,
  dek_iv BYTEA NOT NULL,
  dek_tag BYTEA NOT NULL,
  dek_ct BYTEA NOT NULL,
  versao_kek INTEGER NOT NULL DEFAULT 1,
  eh_ativa BOOLEAN NOT NULL DEFAULT true
);
CREATE TABLE rh.embeddings_faciais (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id BIGINT NOT NULL,
  colaborador_id BIGINT NOT NULL,
  empresa_id BIGINT NOT NULL,
  versao_chave INTEGER NOT NULL,
  embedding_iv BYTEA NOT NULL,
  embedding_tag BYTEA NOT NULL,
  embedding_ct BYTEA NOT NULL
);
`;

/** O bloco `DO $$ ... $$;` que concede SELECT ao papel, do script de bootstrap real. */
function grantsFromBootstrap(): string {
  const script = readFileSync(fileURLToPath(new URL('../../../../db/postgres/bootstrap.sh', import.meta.url)), 'utf8');
  const start = script.indexOf('DO $$');
  const end = script.indexOf('\n$$;', start);
  if (start < 0 || end < 0) throw new Error('bloco DO de genus_coletor_leitura não encontrado em bootstrap.sh');
  return script.slice(start, end + 4);
}

const withDatabase = (url: string, database: string): string => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
};

export async function createAppTestDatabase(arp: ArpTestDatabase): Promise<AppTestDatabase> {
  const password = randomBytes(16).toString('hex');
  const server = new pg.Client({ connectionString: arp.adminUrl });
  await server.connect();
  try {
    await server.query(`CREATE ROLE genus_coletor_leitura LOGIN PASSWORD '${password}'`);
    await server.query('CREATE DATABASE app');
  } finally {
    await server.end();
  }
  const admin = new pg.Pool({ connectionString: withDatabase(arp.adminUrl, 'app'), max: 2 });
  await admin.query('REVOKE ALL ON DATABASE app FROM PUBLIC');
  await admin.query('GRANT CONNECT ON DATABASE app TO genus_coletor_leitura');
  await admin.query(DDL);
  await admin.query(grantsFromBootstrap());

  const reader = new URL(withDatabase(arp.adminUrl, 'app'));
  reader.username = 'genus_coletor_leitura';
  reader.password = password;
  return { readerUrl: reader.toString(), admin, stop: () => admin.end() };
}

export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export async function seedDevice(
  db: AppTestDatabase,
  d: {
    tenantId: number;
    establishmentId: number;
    key: string | null;
    active?: boolean;
    recognition?: number | null;
    liveness?: number | null;
  },
): Promise<number> {
  const { rows } = await db.admin.query<{ id: string }>(
    `INSERT INTO rh.aparelhos (conta_id, estabelecimento_id, chave_hash, ativo, limiar_reconhecimento, limiar_vivacidade)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [d.tenantId, d.establishmentId, d.key === null ? null : sha256(d.key), d.active ?? true, d.recognition ?? null, d.liveness ?? null],
  );
  return Number(rows[0]?.id);
}

/** Cria a DEK de uma empresa (cifrada com a MASTER_KEY) e devolve o valor em claro. */
export async function seedCompanyKey(
  db: AppTestDatabase,
  k: { tenantId: number; companyId: number; version: number; masterKeyHex: string; active?: boolean },
): Promise<Buffer> {
  const dek = generateDek();
  const enc = encryptDek(dek, k.masterKeyHex);
  await db.admin.query(
    `INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, versao_kek, eh_ativa)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      k.tenantId,
      k.companyId,
      k.version,
      Buffer.from(enc.ivHex, 'hex'),
      Buffer.from(enc.tagHex, 'hex'),
      Buffer.from(enc.ciphertextHex, 'hex'),
      enc.keyVersion,
      k.active ?? true,
    ],
  );
  return dek;
}

export async function seedEmployee(
  db: AppTestDatabase,
  e: {
    tenantId: number;
    establishmentId: number;
    cpf: string;
    name: string;
    terminationDate?: string | null;
    /** Sem `face`, o colaborador existe mas não tem rosto cadastrado. */
    face?: { dek: Buffer; companyId: number; version: number };
  },
): Promise<number> {
  const { rows } = await db.admin.query<{ id: string }>(
    `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_desligamento)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [e.tenantId, e.establishmentId, e.cpf, e.name, e.terminationDate ?? null],
  );
  const id = Number(rows[0]?.id);
  if (e.face) {
    const enc = encryptEmbedding(randomUnitVector(), e.face.dek);
    await db.admin.query(
      `INSERT INTO rh.embeddings_faciais (conta_id, colaborador_id, empresa_id, versao_chave, embedding_iv, embedding_tag, embedding_ct)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        e.tenantId,
        id,
        e.face.companyId,
        e.face.version,
        Buffer.from(enc.ivHex, 'hex'),
        Buffer.from(enc.tagHex, 'hex'),
        Buffer.from(enc.ciphertextHex, 'hex'),
      ],
    );
  }
  return id;
}
