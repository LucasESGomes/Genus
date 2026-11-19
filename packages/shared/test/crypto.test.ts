import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptDek,
  decryptEmbedding,
  encryptDek,
  encryptEmbedding,
  generateDek,
  l2Normalize,
  parseMasterKey,
} from '../src/crypto';

const MASTER = randomBytes(32).toString('hex');

function randomVector(): Float32Array {
  const v = new Float32Array(512);
  for (let i = 0; i < 512; i++) v[i] = Math.random() - 0.5;
  return l2Normalize(v);
}

function flipFirst(hex: string): string {
  return (hex[0] === '0' ? '1' : '0') + hex.slice(1);
}

describe('crypto', () => {
  it('ida e volta da DEK e do embedding', () => {
    const dek = generateDek();
    const encDek = encryptDek(dek, MASTER, 3);
    expect(encDek.keyVersion).toBe(3);
    expect(encDek.ivHex).toHaveLength(24);
    expect(encDek.tagHex).toHaveLength(32);
    expect(encDek.ciphertextHex).toHaveLength(64);
    const dek2 = decryptDek(encDek, MASTER);
    expect(dek2.equals(dek)).toBe(true);

    const v = randomVector();
    const enc = encryptEmbedding(v, dek2);
    expect(enc.ciphertextHex).toHaveLength(4096);
    expect(Array.from(decryptEmbedding(enc, dek))).toEqual(Array.from(v));
  });

  it('tag adulterada lança', () => {
    const dek = generateDek();
    const enc = encryptEmbedding(randomVector(), dek);
    expect(() => decryptEmbedding({ ...enc, tagHex: flipFirst(enc.tagHex) }, dek)).toThrow();
    const encDek = encryptDek(dek, MASTER);
    expect(() => decryptDek({ ...encDek, tagHex: flipFirst(encDek.tagHex) }, MASTER)).toThrow();
  });

  it('ciphertext adulterado lança', () => {
    const dek = generateDek();
    const enc = encryptEmbedding(randomVector(), dek);
    expect(() =>
      decryptEmbedding({ ...enc, ciphertextHex: flipFirst(enc.ciphertextHex) }, dek),
    ).toThrow();
  });

  it('chave errada lança', () => {
    const dek = generateDek();
    expect(() => decryptDek(encryptDek(dek, MASTER), randomBytes(32).toString('hex'))).toThrow();
    const enc = encryptEmbedding(randomVector(), dek);
    expect(() => decryptEmbedding(enc, generateDek())).toThrow();
  });

  it('IV diferente a cada cifra', () => {
    const dek = generateDek();
    const v = randomVector();
    const a = encryptEmbedding(v, dek);
    const b = encryptEmbedding(v, dek);
    expect(a.ivHex).not.toBe(b.ivHex);
    expect(a.ciphertextHex).not.toBe(b.ciphertextHex);
    expect(encryptDek(dek, MASTER).ivHex).not.toBe(encryptDek(dek, MASTER).ivHex);
  });

  it('tamanhos errados lançam', () => {
    const dek = generateDek();
    expect(() => encryptEmbedding(new Float32Array(100), dek)).toThrow(/512/);
    expect(() => encryptEmbedding(randomVector(), randomBytes(16))).toThrow(/32 bytes/);
    expect(() => encryptDek(randomBytes(31), MASTER)).toThrow(/32 bytes/);
    const enc = encryptEmbedding(randomVector(), dek);
    expect(() => decryptEmbedding({ ...enc, ivHex: enc.ivHex.slice(2) }, dek)).toThrow(/12 bytes/);
    expect(() => decryptEmbedding({ ...enc, tagHex: 'zz' }, dek)).toThrow(/hex/);
  });

  it('parseMasterKey valida 64 hex', () => {
    expect(parseMasterKey(MASTER)).toHaveLength(32);
    expect(() => parseMasterKey('abc')).toThrow(/MASTER_KEY/);
    expect(() => parseMasterKey('g'.repeat(64))).toThrow(/MASTER_KEY/);
  });

  it('l2Normalize', () => {
    const n = l2Normalize(new Float32Array([3, 4]));
    expect(n[0]).toBeCloseTo(0.6);
    expect(n[1]).toBeCloseTo(0.8);
    expect(() => l2Normalize(new Float32Array(4))).toThrow();
  });
});
