import { describe, expect, it } from 'vitest';
import { param, workweekParams } from '../../../../test/support/rh-legal-fixtures';
import { checkWeek, resolveWorkweekRule, type PlannedDay } from './weekly-limit';

// 6x1 de 7 h 20: 44 h e 1 folga
const sixByOne: PlannedDay[] = [440, 440, 440, 440, 440, 440, 0].map((m, i) => ({
  date: `2026-12-0${i + 1}`,
  expectedMinutes: m,
}));

describe('resolveWorkweekRule (RN06, EC 141/2026)', () => {
  it.each([
    ['2026-12-15', 2640, 1],
    ['2026-12-16', 2520, 2],
    ['2027-12-15', 2520, 2],
    ['2027-12-16', 2400, 2],
  ])('em %s vale %i min e %i folga(s)', (date, max, rest) => {
    expect(resolveWorkweekRule(workweekParams(), date)).toMatchObject({ maxWeeklyMinutes: max, minWeeklyRestDays: rest });
  });

  it('o limite vem do parâmetro: uma liminar do STF é uma linha nova, sem código', () => {
    const suspended = [...workweekParams().filter((r) => r.validFrom !== '2026-12-16' || r.key !== 'jornada_semanal_max_min')];
    suspended.push(param('jornada_semanal_max_min', 2640, { validFrom: '2026-12-16', validTo: '2027-12-15' }));
    expect(resolveWorkweekRule(suspended, '2027-01-10').maxWeeklyMinutes).toBe(2640);
  });

  it('sem parâmetro vigente, falha', () => {
    expect(() => resolveWorkweekRule([], '2026-12-16')).toThrow(expect.objectContaining({ code: 'PARAMETRO_AUSENTE' }));
  });
});

describe('checkWeek: só avisa, não bloqueia', () => {
  it('6x1 de 44 h passa até 15/12/2026', () => {
    expect(checkWeek(sixByOne, resolveWorkweekRule(workweekParams(), '2026-12-15'))).toEqual([]);
  });

  it('a mesma escala a partir de 16/12/2026 gera os dois avisos', () => {
    const warnings = checkWeek(sixByOne, resolveWorkweekRule(workweekParams(), '2026-12-16'));
    expect(warnings.map((w) => w.code)).toEqual(['carga_semanal_acima_limite', 'folgas_abaixo_minimo']);
  });

  it('5x2 de 8 h (40 h) passa também a partir de 16/12/2027', () => {
    const fiveByTwo = [480, 480, 480, 480, 480, 0, 0].map((m, i) => ({ date: `2027-12-2${i}`, expectedMinutes: m }));
    expect(checkWeek(fiveByTwo, resolveWorkweekRule(workweekParams(), '2027-12-16'))).toEqual([]);
  });

  it.todo('semana que atravessa 16/12/2026 ou 16/12/2027: qual regra vale está [A CONFIRMAR] (04 G2)');
});
