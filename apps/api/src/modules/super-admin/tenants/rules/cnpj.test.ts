import { describe, expect, it } from 'vitest';
import { isValidCnpj } from './cnpj';

describe('isValidCnpj', () => {
  it.each([
    ['11222333000181', true],
    ['11444777000161', true],
    ['00000000000191', true], // Banco do Brasil, CNPJ público
    ['11222333000182', false], // segundo dígito errado
    ['11222333000171', false], // primeiro dígito errado
    ['11111111111111', false], // todos iguais
    ['00000000000000', false],
    ['1122233300018', false], // 13 dígitos
    ['112223330001811', false], // 15 dígitos
    ['11.222.333/0001-81', false], // com pontuação
    ['1122233300018a', false],
    ['', false],
  ])('%s -> %s', (cnpj, expected) => {
    expect(isValidCnpj(cnpj)).toBe(expected);
  });
});
