/**
 * Segredos do convite. O token (32 bytes aleatórios, base64url) sai uma única vez na resposta de quem
 * convida; o banco guarda só o SHA-256. O CPF vira HMAC-SHA256 com chave derivada do segredo do
 * Better Auth (HKDF-SHA256, sal 'genus', info 'invite-cpf'): sem a chave, um vazamento do banco não
 * permite testar CPFs. Nada daqui vai para log, auditoria ou resposta (menos o token, na criação).
 */
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

export const hashInviteToken = (token: string): Buffer => createHash('sha256').update(token).digest();

export function generateInviteToken(): { token: string; tokenHash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function deriveInviteCpfKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'genus', 'invite-cpf', 32));
}

/** `cpf` já normalizado (só dígitos). */
export const hashInviteCpf = (key: Buffer, cpf: string): Buffer => createHmac('sha256', key).update(cpf).digest();

export const sameDigest = (a: Buffer, b: Buffer): boolean => a.length === b.length && timingSafeEqual(a, b);
