import { describe, expect, it } from 'vitest';
import { deriveEmailHashKey, hashLoginEmail } from './email-hash';

describe('email-hash', () => {
  const key = deriveEmailHashKey('segredo-de-teste-com-mais-de-32-caracteres-0123456789');

  it('deriva uma chave de 32 bytes, estável para o mesmo segredo e diferente para outro', () => {
    expect(key).toHaveLength(32);
    expect(deriveEmailHashKey('segredo-de-teste-com-mais-de-32-caracteres-0123456789').equals(key)).toBe(true);
    expect(deriveEmailHashKey('outro-segredo-de-teste-com-mais-de-32-caracteres').equals(key)).toBe(false);
  });

  it.each([
    ['maiúsculas', 'Ana@Exemplo.Dev', 'ana@exemplo.dev'],
    ['espaços nas pontas', '  ana@exemplo.dev ', 'ana@exemplo.dev'],
  ])('normaliza %s', (_label, input, canonical) => {
    expect(hashLoginEmail(key, input).equals(hashLoginEmail(key, canonical))).toBe(true);
  });

  it('e-mails diferentes dão hashes diferentes, de 32 bytes, que não contêm o e-mail', () => {
    const a = hashLoginEmail(key, 'a@exemplo.dev');
    const b = hashLoginEmail(key, 'b@exemplo.dev');
    expect(a.equals(b)).toBe(false);
    expect(a).toHaveLength(32);
    expect(a.toString('latin1')).not.toContain('exemplo');
  });

  it('chave diferente muda o hash', () => {
    const other = deriveEmailHashKey('outro-segredo-de-teste-com-mais-de-32-caracteres');
    expect(hashLoginEmail(other, 'a@exemplo.dev').equals(hashLoginEmail(key, 'a@exemplo.dev'))).toBe(false);
  });

  it('e-mail vazio tem hash (tentativa sem e-mail identificável)', () => {
    expect(hashLoginEmail(key, '')).toHaveLength(32);
  });
});
