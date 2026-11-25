/**
 * Chave do aparelho (totem): `gk_` + 40 hex (160 bits de `randomBytes`). Só o SHA-256 vai ao banco;
 * a chave em claro aparece uma vez, na resposta de criar ou regenerar. Nunca em log nem em auditoria.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEVICE_KEY_SHAPE = /^gk_[0-9a-f]{40}$/;

export interface GeneratedDeviceKey {
  /** Em claro. Só para a resposta. */
  key: string;
  hash: Buffer;
  /** 8 primeiros caracteres, para o RH reconhecer a chave. */
  prefix: string;
}

export const hashDeviceKey = (key: string): Buffer => createHash('sha256').update(key, 'utf8').digest();

export function generateDeviceKey(): GeneratedDeviceKey {
  const key = `gk_${randomBytes(20).toString('hex')}`;
  return { key, hash: hashDeviceKey(key), prefix: key.slice(0, 8) };
}

/** Comparação em tempo constante entre dois SHA-256. */
export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
