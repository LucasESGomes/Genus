import { describe, expect, it } from 'vitest';
import type { DayResult, InconsistencyCode } from './day';
import { asOpenDay } from './open-day';

const day = (over: Partial<DayResult> = {}): DayResult => ({
  workDate: '2026-11-26',
  situation: 'normal',
  status: 'calculada',
  expectedMinutes: 480,
  workedClockMinutes: 240,
  workedMinutes: 240,
  breakMinutes: 0,
  suppressedBreakMinutes: 60,
  lateMinutes: 20,
  earlyLeaveMinutes: 240,
  shortfallMinutes: 240,
  absenceMinutes: 0,
  overtime50Minutes: 0,
  overtime100Minutes: 0,
  nightClockMinutes: 0,
  nightEquivalentMinutes: 0,
  interjourneyMinutes: null,
  toleranceApplied: false,
  holidayTreatment: null,
  inconsistencies: [],
  parameterVersion: 'x',
  ...over,
});

describe('asOpenDay', () => {
  it('zera falta, atraso e saída antecipada e mantém marcações e minutos trabalhados', () => {
    expect(asOpenDay(day())).toMatchObject({
      expectedMinutes: 480,
      workedMinutes: 240,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      shortfallMinutes: 0,
      absenceMinutes: 0,
      suppressedBreakMinutes: 0,
    });
  });

  it('sem marcação ainda não é falta', () => {
    expect(asOpenDay(day({ situation: 'falta', absenceMinutes: 480 }))).toMatchObject({ situation: 'normal', absenceMinutes: 0 });
    expect(asOpenDay(day({ situation: 'folga' })).situation).toBe('folga');
  });

  it.each<[InconsistencyCode[], InconsistencyCode[], DayResult['status']]>([
    [['marcacoes_impares'], [], 'calculada'],
    [['marcacao_ausente', 'intervalo_ausente', 'intervalo_insuficiente'], [], 'calculada'],
    [['interjornada_insuficiente', 'marcacoes_impares'], ['interjornada_insuficiente'], 'calculada'],
    [['marcacao_duplicada', 'marcacoes_impares'], ['marcacao_duplicada'], 'inconsistente'],
    [
      ['extras_acima_limite', 'marcacao_fora_da_escala', 'marcacao_fora_de_ordem'],
      ['extras_acima_limite', 'marcacao_fora_da_escala', 'marcacao_fora_de_ordem'],
      'calculada',
    ],
  ])('inconsistências %j viram %j (%s)', (before, after, status) => {
    const out = asOpenDay(day({ inconsistencies: before, status: 'inconsistente' }));
    expect(out.inconsistencies).toEqual(after);
    expect(out.status).toBe(status);
  });
});
