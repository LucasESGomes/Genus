import { describe, expect, it } from 'vitest';
import { generateFakeCpf, isValidCpf } from '../src/candidates/cpf';

describe('cpf', () => {
  it('valida CPFs conhecidos', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
    expect(isValidCpf('529.982.247-25')).toBe(false);
  });

  it('gera CPFs válidos, determinísticos e distintos', () => {
    const cpfs = Array.from({ length: 2000 }, (_, i) => generateFakeCpf(i));
    expect(cpfs.every(isValidCpf)).toBe(true);
    expect(new Set(cpfs).size).toBe(cpfs.length);
    expect(generateFakeCpf(5)).toBe(generateFakeCpf(5));
  });

  it('índice inválido lança', () => {
    expect(() => generateFakeCpf(-1)).toThrow();
    expect(() => generateFakeCpf(1.5)).toThrow();
  });
});
