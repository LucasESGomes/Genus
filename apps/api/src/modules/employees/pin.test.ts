import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIN_HASH_PARAMS,
  generatePin,
  hashPin,
  isValidPinFormat,
  isWeakPin,
  pinHashNeedsRehash,
  verifyPin,
  type PinPepper,
} from './pin';

// PINs e peppers fictícios. Sal fixo só nos testes que precisam de saída determinística.
const PEPPER_1: PinPepper = { version: 1, key: Buffer.alloc(32, 0xa1) };
const PEPPER_2: PinPepper = { version: 2, key: Buffer.alloc(32, 0xb2) };
const SALT_A = Buffer.alloc(16, 1);
const SALT_B = Buffer.alloc(16, 2);

describe('formato e força do PIN', () => {
  it('só dígitos, de 4 a 6', () => {
    expect(['1234', '12345', '123456'].every(isValidPinFormat)).toBe(true);
    expect(['123', '1234567', '12a4', ' 1234', '', '١٢٣٤'].some(isValidPinFormat)).toBe(false);
  });

  it('fraco: todos iguais ou em sequência', () => {
    expect(['0000', '111111', '1234', '456789', '9876', '3210'].every(isWeakPin)).toBe(true);
    expect(['1243', '482915', '1357', '0101'].some(isWeakPin)).toBe(false);
  });

  it('generatePin sorteia 6 dígitos fortes e pula os fracos', () => {
    for (let i = 0; i < 50; i++) {
      const pin = generatePin();
      expect(isValidPinFormat(pin) && !isWeakPin(pin) && pin.length === 6).toBe(true);
    }
    // gerador viciado: primeiro 1,2,3,4 (fraco, descartado), depois 4,8,2,9
    const seq = [1, 2, 3, 4, 4, 8, 2, 9];
    expect(generatePin(4, () => seq.shift() ?? 0)).toBe('4829');
    expect(() => generatePin(3)).toThrow(expect.objectContaining({ code: 'PIN_FORMATO_INVALIDO' }));
  });
});

describe('hash do PIN (scrypt com sal e pepper)', () => {
  it('o hash guarda versão do pepper, parâmetros, sal e chave; nunca o PIN', async () => {
    const h = await hashPin('482915', PEPPER_1, { salt: SALT_A });
    const { N, r, p } = DEFAULT_PIN_HASH_PARAMS;
    expect(h).toMatch(new RegExp(`^scrypt\\$1\\$${N}\\$${r}\\$${p}\\$[A-Za-z0-9_-]+\\$[A-Za-z0-9_-]+$`));
    expect(h).not.toContain('482915');
  });

  it('o PIN certo confere e o errado não', async () => {
    const h = await hashPin('482915', PEPPER_1);
    expect(await verifyPin('482915', h, [PEPPER_1])).toBe(true);
    expect(await verifyPin('482916', h, [PEPPER_1])).toBe(false);
    expect(await verifyPin('48291', h, [PEPPER_1])).toBe(false);
    expect(await verifyPin('abcd', h, [PEPPER_1])).toBe(false);
  });

  it('sem o pepper certo o hash não serve: vazar o banco não basta', async () => {
    const h = await hashPin('482915', PEPPER_1, { salt: SALT_A });
    const wrongKeySameVersion: PinPepper = { version: 1, key: Buffer.alloc(32, 0xff) };
    expect(await verifyPin('482915', h, [wrongKeySameVersion])).toBe(false);
    await expect(verifyPin('482915', h, [PEPPER_2])).rejects.toMatchObject({ code: 'PIN_PEPPER_INVALIDO' });
  });

  it('rotação: o hash antigo confere com a chave antiga e pede rehash', async () => {
    const old = await hashPin('482915', PEPPER_1);
    expect(await verifyPin('482915', old, [PEPPER_2, PEPPER_1])).toBe(true);
    expect(pinHashNeedsRehash(old, PEPPER_2)).toBe(true);
    const fresh = await hashPin('482915', PEPPER_2);
    expect(pinHashNeedsRehash(fresh, PEPPER_2)).toBe(false);
  });

  it('o mesmo PIN com sais diferentes gera hashes diferentes', async () => {
    const a = await hashPin('482915', PEPPER_1, { salt: SALT_A });
    const b = await hashPin('482915', PEPPER_1, { salt: SALT_B });
    expect(a).not.toBe(b);
    expect(await hashPin('482915', PEPPER_1, { salt: SALT_A })).toBe(a);
  });

  it('o custo vai no hash: outro N continua conferindo e pede rehash', async () => {
    const h = await hashPin('482915', PEPPER_1, { params: { N: 2 ** 14, r: 8, p: 1 } });
    expect(h.startsWith('scrypt$1$16384$8$1$')).toBe(true);
    expect(await verifyPin('482915', h, [PEPPER_1])).toBe(true);
    expect(pinHashNeedsRehash(h, PEPPER_1)).toBe(true);
  });

  it.each(['123', '1234567', '12a4', '12 34'])('PIN %j é recusado', async (pin) => {
    await expect(hashPin(pin, PEPPER_1)).rejects.toMatchObject({ code: 'PIN_FORMATO_INVALIDO' });
  });

  it.each(['0000', '123456', '987654'])('PIN fraco %j é recusado', async (pin) => {
    await expect(hashPin(pin, PEPPER_1)).rejects.toMatchObject({ code: 'PIN_FRACO' });
  });

  it('pepper curto, sem versão ou sal curto são recusados', async () => {
    await expect(hashPin('4829', { version: 1, key: Buffer.alloc(16) })).rejects.toMatchObject({ code: 'PIN_PEPPER_INVALIDO' });
    await expect(hashPin('4829', { version: 0, key: Buffer.alloc(32) })).rejects.toMatchObject({ code: 'PIN_PEPPER_INVALIDO' });
    await expect(hashPin('4829', PEPPER_1, { salt: Buffer.alloc(8) })).rejects.toMatchObject({ code: 'PIN_HASH_INVALIDO' });
  });

  it('hash malformado ou com parâmetro adulterado é recusado', async () => {
    const good = await hashPin('482915', PEPPER_1, { salt: SALT_A });
    const parts = good.split('$');
    const tamper = (i: number, v: string) => parts.map((x, j) => (j === i ? v : x)).join('$');
    const bad = [
      '',
      'x',
      'bcrypt$1$1$2$3$4$5',
      parts.slice(0, 6).join('$'),
      tamper(1, 'v1'),
      tamper(2, String(2 ** 30)), // N enorme: travaria o processo
      tamper(2, '1024'), // N fraco
      tamper(2, '20000'), // não é potência de 2
      tamper(3, '0'),
      tamper(4, '99'),
      tamper(5, 'AQ'), // sal curto
      tamper(6, 'AQID'), // chave com tamanho errado
      tamper(6, 'não+base64'),
    ];
    for (const h of bad) {
      await expect(verifyPin('482915', h, [PEPPER_1]), h).rejects.toMatchObject({ code: 'PIN_HASH_INVALIDO' });
    }
  });
});
