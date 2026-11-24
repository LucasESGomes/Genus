import { describe, expect, it } from 'vitest';
import { param } from '../../../../test/support/rh-legal-fixtures';
import { RhDomainError } from '../../rules-common/rules/errors';
import { ParameterReader, resolveParameter } from './resolve';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof RhDomainError ? e.code : 'outro';
  }
  return undefined;
}

describe('resolveParameter (RF10, RNF06)', () => {
  // Fixture: troca de valor em 16/12/2026, como na RN06
  const rows = [
    param('jornada_semanal_max_min', 2640, { validTo: '2026-12-15' }),
    param('jornada_semanal_max_min', 2520, { validFrom: '2026-12-16' }),
  ];

  it('escolhe a linha vigente na data, com as bordas inclusivas', () => {
    expect(resolveParameter(rows, 'jornada_semanal_max_min', '2026-12-15').value).toBe(2640);
    expect(resolveParameter(rows, 'jornada_semanal_max_min', '2026-12-16').value).toBe(2520);
  });

  it('falha com PARAMETRO_AUSENTE se nada estiver vigente', () => {
    const only = [param('x', 1, { validFrom: '2027-01-01' })];
    expect(codeOf(() => resolveParameter(only, 'x', '2026-12-31'))).toBe('PARAMETRO_AUSENTE');
    expect(codeOf(() => resolveParameter(only, 'y', '2027-06-01'))).toBe('PARAMETRO_AUSENTE');
  });

  it('falha com PARAMETRO_AMBIGUO se houver duas linhas vigentes no mesmo nível', () => {
    const dup = [param('x', 1), param('x', 2, { validFrom: '2026-01-01' })];
    expect(codeOf(() => resolveParameter(dup, 'x', '2026-06-01'))).toBe('PARAMETRO_AMBIGUO');
  });

  it('linha da empresa tem precedência sobre o padrão legal [A CONFIRMAR]', () => {
    const mixed = [param('x', 5), param('x', 3, { companyId: 'emp1' })];
    expect(resolveParameter(mixed, 'x', '2026-06-01', { companyId: 'emp1' }).value).toBe(3);
    expect(resolveParameter(mixed, 'x', '2026-06-01', { companyId: 'emp2' }).value).toBe(5);
    expect(resolveParameter(mixed, 'x', '2026-06-01').value).toBe(5);
  });

  it('o leitor recusa tipo errado e registra a versão usada', () => {
    const reader = new ParameterReader([param('a', 1.5), param('b', 10), param('c', '22:00')], '2026-06-01');
    expect(codeOf(() => reader.int('a'))).toBe('PARAMETRO_INVALIDO');
    expect(reader.int('b')).toBe(10);
    expect(reader.timeOfDay('c')).toBe(1320);
    expect(reader.version()).toMatch(/^a@fx\d+;b@fx\d+;c@fx\d+$/);
  });
});
