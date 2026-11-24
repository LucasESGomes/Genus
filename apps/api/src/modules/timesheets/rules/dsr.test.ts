import { describe, expect, it } from 'vitest';
import { computeWeeklyRest, type WeekDayForDsr } from './dsr';

// A VALIDAR PELO CONTADOR (RN08, Lei 605/1949 art. 6º)
const week = (overrides: Partial<WeekDayForDsr>[] = []): WeekDayForDsr[] =>
  ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'].map((workDate, i) => ({
    workDate,
    absenceMinutes: 0,
    waivedMinutes: 0,
    coveredByLeave: false,
    ...overrides[i],
  }));

describe('computeWeeklyRest (RN08)', () => {
  it('semana completa mantém o DSR', () => {
    expect(computeWeeklyRest(week())).toEqual({ dsrLost: false, unjustifiedAbsenceDates: [] });
  });

  it('falta injustificada desconta o DSR', () => {
    const r = computeWeeklyRest(week([{}, { absenceMinutes: 480 }]));
    expect(r).toEqual({ dsrLost: true, unjustifiedAbsenceDates: ['2026-11-24'] });
  });

  it('falta abonada ou coberta por afastamento não desconta', () => {
    expect(computeWeeklyRest(week([{ absenceMinutes: 480, waivedMinutes: 480 }])).dsrLost).toBe(false);
    expect(computeWeeklyRest(week([{ absenceMinutes: 480, coveredByLeave: true }])).dsrLost).toBe(false);
  });

  it.todo('reflexo das horas extras no DSR: fórmula [A CONFIRMAR] com o contador (04 G4)');
  it.todo('perda também do feriado da semana: não está na especificação');
  it.todo('atrasos na semana afetam o DSR?: não está na especificação');
});
