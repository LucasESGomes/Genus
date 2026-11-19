/**
 * Criptografia compatível com o face-engine (services/face-engine/app/utils/crypto.py
 * e app/services/dek_manager.py): AES-256-GCM, IV de 12 B, tag de 16 B, ciphertext
 * SEM a tag, tudo em hex e em campos separados, sem AAD.
 *
 * Envelope: a DEK (32 B) da conta é cifrada com a MASTER_KEY (64 hex); cada
 * embedding (512 float32 little-endian, L2) é cifrado com a DEK.
 * Falha de autenticação (tag) LANÇA: nunca devolve null nem "não identificado".
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  EMBEDDING_BYTES,
  EMBEDDING_DIMENSIONS,
} from './contracts/engine.js';
import type { EncryptedDek, EncryptedEmbedding, EncryptedHex } from './interfaces.js';

const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/;

function fromHex(name: string, hex: string, expectedBytes?: number): Buffer {
  if (!HEX_RE.test(hex)) throw new Error(`${name}: hex inválido`);
  const buf = Buffer.from(hex, 'hex');
  if (expectedBytes !== undefined && buf.length !== expectedBytes) {
    throw new Error(`${name}: esperado ${expectedBytes} bytes, recebido ${buf.length}`);
  }
  return buf;
}

function assertKey(key: Buffer, name: string): void {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(`${name} deve ter ${AES_KEY_BYTES} bytes, recebido ${key.length}`);
  }
}

function seal(key: Buffer, plaintext: Buffer): EncryptedHex {
  const iv = randomBytes(AES_GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AES_GCM_TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ivHex: iv.toString('hex'),
    tagHex: cipher.getAuthTag().toString('hex'),
    ciphertextHex: ciphertext.toString('hex'),
  };
}

function open(key: Buffer, enc: EncryptedHex, label: string): Buffer {
  const iv = fromHex(`${label}.iv`, enc.ivHex, AES_GCM_IV_BYTES);
  const tag = fromHex(`${label}.tag`, enc.tagHex, AES_GCM_TAG_BYTES);
  const ciphertext = fromHex(`${label}.ciphertext`, enc.ciphertextHex);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AES_GCM_TAG_BYTES });
  decipher.setAuthTag(tag);
  // `final()` lança "Unsupported state or unable to authenticate data" se a tag não bater.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Valida e converte a MASTER_KEY (64 caracteres hex = 32 bytes). */
export function parseMasterKey(hex: string): Buffer {
  if (typeof hex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('MASTER_KEY inválida: esperado 64 caracteres hexadecimais (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** DEK nova (32 bytes aleatórios). */
export function generateDek(): Buffer {
  return randomBytes(AES_KEY_BYTES);
}

export function encryptDek(dek: Buffer, masterKeyHex: string, keyVersion = 1): EncryptedDek {
  assertKey(dek, 'DEK');
  return { ...seal(parseMasterKey(masterKeyHex), dek), keyVersion };
}

export function decryptDek(enc: EncryptedDek, masterKeyHex: string): Buffer {
  const dek = open(parseMasterKey(masterKeyHex), enc, 'dek');
  assertKey(dek, 'DEK decifrada');
  return dek;
}

export function encryptEmbedding(
  vector: Float32Array,
  dek: Buffer,
  keyVersion = 1,
): EncryptedEmbedding {
  assertKey(dek, 'DEK');
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Embedding deve ter ${EMBEDDING_DIMENSIONS} dimensões, recebido ${vector.length}`);
  }
  const plaintext = Buffer.alloc(EMBEDDING_BYTES);
  vector.forEach((value, i) => plaintext.writeFloatLE(value, i * 4));
  return { ...seal(dek, plaintext), keyVersion };
}

export function decryptEmbedding(enc: EncryptedEmbedding, dek: Buffer): Float32Array {
  assertKey(dek, 'DEK');
  const plaintext = open(dek, enc, 'embedding');
  if (plaintext.length !== EMBEDDING_BYTES) {
    throw new Error(`Embedding decifrado deve ter ${EMBEDDING_BYTES} bytes, recebido ${plaintext.length}`);
  }
  const out = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) out[i] = plaintext.readFloatLE(i * 4);
  return out;
}

/** Normaliza para norma L2 = 1. Vetor nulo lança. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) throw new Error('Vetor nulo não pode ser normalizado');
  return v.map((x) => x / norm);
}
