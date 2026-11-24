/**
 * Ponte entre o que a criptografia já pronta produz (packages/shared/src/crypto.ts
 * e o face-engine, em hex) e o que o banco do RH guarda (BYTEA em chaves_empresa
 * e embeddings_faciais). Só converte formato: não cifra nem decifra nada.
 * Nada daqui vai para log.
 */
import type { EncryptedDek, EncryptedEmbedding } from '@genus/shared';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;
const EMBEDDING_CT_BYTES = 2048;

/** Colunas `dek_*` de chaves_empresa. */
export interface StoredCompanyKey {
  keyVersion: number;
  masterKeyVersion: number;
  dekIv: Buffer;
  dekTag: Buffer;
  dekCt: Buffer;
}

/** Colunas `embedding_*` de embeddings_faciais. */
export interface StoredEmbedding {
  keyVersion: number;
  embeddingIv: Buffer;
  embeddingTag: Buffer;
  embeddingCt: Buffer;
}

function fromHex(name: string, hex: string, bytes: number): Buffer {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw new Error(`${name}: hex inválido`);
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== bytes) throw new Error(`${name}: esperado ${bytes} bytes, recebido ${buf.length}`);
  return buf;
}

/**
 * DEK cifrada (saída de `encryptDek`) → colunas de chaves_empresa.
 * `keyVersion` é a versão da DEK da empresa; a versão da MASTER_KEY vem do
 * `EncryptedDek.keyVersion` (é o `dek_key_version` da engine).
 */
export function toStoredCompanyKey(enc: EncryptedDek, keyVersion: number): StoredCompanyKey {
  return {
    keyVersion,
    masterKeyVersion: enc.keyVersion,
    dekIv: fromHex('dek_iv', enc.ivHex, IV_BYTES),
    dekTag: fromHex('dek_tag', enc.tagHex, TAG_BYTES),
    dekCt: fromHex('dek_ct', enc.ciphertextHex, DEK_BYTES),
  };
}

/** Colunas de chaves_empresa → DEK cifrada, como `decryptDek` e a engine recebem. */
export function fromStoredCompanyKey(row: StoredCompanyKey): EncryptedDek {
  return {
    ivHex: row.dekIv.toString('hex'),
    tagHex: row.dekTag.toString('hex'),
    ciphertextHex: row.dekCt.toString('hex'),
    keyVersion: row.masterKeyVersion,
  };
}

/** Embedding cifrado (saída da engine ou de `encryptEmbedding`) → colunas de embeddings_faciais. */
export function toStoredEmbedding(enc: EncryptedEmbedding): StoredEmbedding {
  return {
    keyVersion: enc.keyVersion,
    embeddingIv: fromHex('embedding_iv', enc.ivHex, IV_BYTES),
    embeddingTag: fromHex('embedding_tag', enc.tagHex, TAG_BYTES),
    embeddingCt: fromHex('embedding_ct', enc.ciphertextHex, EMBEDDING_CT_BYTES),
  };
}

/** Colunas de embeddings_faciais → embedding cifrado, como `decryptEmbedding` e a engine recebem. */
export function fromStoredEmbedding(row: StoredEmbedding): EncryptedEmbedding {
  return {
    ivHex: row.embeddingIv.toString('hex'),
    tagHex: row.embeddingTag.toString('hex'),
    ciphertextHex: row.embeddingCt.toString('hex'),
    keyVersion: row.keyVersion,
  };
}

/**
 * `tenant_id` que vai à engine. A engine guarda a DEK em cache por `tenant_id`;
 * como a DEK é por EMPRESA, o id precisa ser da empresa (duas empresas da mesma
 * conta com o mesmo `tenant_id` dariam InvalidTag). Também vira nome de pasta na engine.
 */
export function engineTenantId(companyId: number): string {
  if (!Number.isSafeInteger(companyId) || companyId < 1) throw new Error('companyId inválido');
  return `empresa-${companyId}`;
}
