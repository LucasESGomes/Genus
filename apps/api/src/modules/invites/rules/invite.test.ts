import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveInviteCpfKey, generateInviteToken, hashInviteCpf, hashInviteToken, sameDigest } from '../crypto';
import { deriveEmailHashKey } from '../../super-admin/access-logs/email-hash';
import { createInviteBody } from '../schemas';
import { inviteExpiresAt, inviteStatus, maskEmail } from './invite';

const now = new Date('2026-11-25T12:00:00Z');

describe('situação do convite', () => {
  it('vale por 72 h', () => {
    expect(inviteExpiresAt(now).toISOString()).toBe('2026-11-28T12:00:00.000Z');
  });

  it.each([
    ['pendente', 1, 'pendente'],
    ['pendente', 0, 'expirado'],
    ['pendente', -1, 'expirado'],
    ['aceito', -1, 'aceito'],
    ['revogado', 1, 'revogado'],
    ['revogado', -1, 'revogado'],
  ] as const)('%s com %i ms de prazo → %s', (status, left, expected) => {
    expect(inviteStatus({ status, expiresAt: new Date(now.getTime() + left) }, now)).toBe(expected);
  });
});

describe('e-mail mascarado', () => {
  it.each([
    ['maria.silva@empresa.com.br', 'm***@empresa.com.br'],
    ['a@x.dev', 'a***@x.dev'],
    ['sem-arroba', '***'],
    ['@x.dev', '***'],
  ])('%s → %s', (email, masked) => {
    expect(maskEmail(email)).toBe(masked);
  });
});

describe('papéis aceitos', () => {
  const body = { name: 'Pessoa Fictícia', email: 'pessoa@exemplo.dev', cpf: '52998224725' };

  it.each(['admin', 'rh'])('%s passa', (role) => {
    expect(createInviteBody.safeParse({ ...body, role }).success).toBe(true);
  });

  it.each(['super_admin', 'gestor', 'contador', 'colaborador', ''])('"%s" é recusado', (role) => {
    expect(createInviteBody.safeParse({ ...body, role }).success).toBe(false);
  });

  it('conta no corpo é descartada', () => {
    expect(createInviteBody.parse({ ...body, role: 'rh', tenantId: 99 })).not.toHaveProperty('tenantId');
  });
});

describe('segredos do convite', () => {
  it('token de 32 bytes em base64url, único, com SHA-256 guardado', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toEqual(createHash('sha256').update(a.token).digest());
    expect(hashInviteToken(a.token)).toEqual(a.tokenHash);
  });

  it('o HMAC do CPF depende do segredo e usa chave própria', () => {
    const secret = 'segredo-de-teste-com-mais-de-32-caracteres';
    const key = deriveInviteCpfKey(secret);
    const hash = hashInviteCpf(key, '52998224725');
    expect(sameDigest(hash, hashInviteCpf(deriveInviteCpfKey(secret), '52998224725'))).toBe(true);
    expect(sameDigest(hash, hashInviteCpf(deriveInviteCpfKey(`${secret}x`), '52998224725'))).toBe(false);
    expect(sameDigest(hash, hashInviteCpf(key, '11144477735'))).toBe(false);
    expect(sameDigest(hash, Buffer.alloc(8))).toBe(false);
    expect(key.equals(deriveEmailHashKey(secret))).toBe(false);
  });
});
