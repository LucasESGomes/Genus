import { describe, expect, it } from 'vitest';
import { positionFor, resolveScheduleDay, type ScheduleDef } from './day-schedule';

const weekday = (pos: number, over: Partial<ScheduleDef['days'][number]> = {}) => ({
  position: pos,
  isDayOff: false,
  startTime: '07:00',
  endTime: '16:00',
  breakStartTime: '11:00',
  breakEndTime: '12:00',
  crossesMidnight: false,
  ...over,
});

const fiveByTwo: ScheduleDef = { cycleType: 'semanal', cycleDays: null, referenceDate: null, days: [1, 2, 3, 4, 5].map((p) => weekday(p)) };

describe('resolveScheduleDay', () => {
  it.each([
    ['2026-11-23', 1, 'trabalho'], // segunda
    ['2026-11-28', 6, 'folga'], // sábado sem linha
    ['2026-11-29', 0, 'folga'], // domingo
  ])('semanal: %s → posição %i, %s', (date, pos, kind) => {
    expect(positionFor(fiveByTwo, date)).toBe(pos);
    expect(resolveScheduleDay(fiveByTwo, date).schedule.kind).toBe(kind);
  });

  it('dia útil com intervalo: 4 marcações previstas e 8 h de carga', () => {
    const r = resolveScheduleDay(fiveByTwo, '2026-11-23');
    expect(r.schedule).toEqual({ kind: 'trabalho', expectedPunches: ['2026-11-23T07:00', '2026-11-23T11:00', '2026-11-23T12:00', '2026-11-23T16:00'] });
    expect(r.plannedMinutes).toBe(480);
    expect(r.crossesMidnight).toBe(false);
  });

  it('12x36 cíclico: alterna a partir da data de referência, com saída no dia seguinte', () => {
    const def: ScheduleDef = {
      cycleType: 'ciclico',
      cycleDays: 2,
      referenceDate: '2026-11-01',
      days: [weekday(0, { startTime: '19:00', endTime: '07:00', breakStartTime: '01:00', breakEndTime: '02:00', crossesMidnight: true }), { ...weekday(1), isDayOff: true, startTime: null, endTime: null, breakStartTime: null, breakEndTime: null }],
    };
    const work = resolveScheduleDay(def, '2026-11-03');
    expect(work.schedule).toEqual({
      kind: 'trabalho',
      expectedPunches: ['2026-11-03T19:00', '2026-11-04T01:00', '2026-11-04T02:00', '2026-11-04T07:00'],
    });
    expect(work.crossesMidnight).toBe(true);
    expect(work.plannedMinutes).toBe(660);
    expect(resolveScheduleDay(def, '2026-11-04').schedule.kind).toBe('folga');
    // antes da referência também alterna
    expect(resolveScheduleDay(def, '2026-10-31').schedule.kind).toBe('folga');
    expect(resolveScheduleDay(def, '2026-10-30').schedule.kind).toBe('trabalho');
  });

  it('troca de turno substitui a escala: folga num dia útil e turno num sábado', () => {
    expect(resolveScheduleDay(fiveByTwo, '2026-11-23', { isDayOff: true, startTime: null, endTime: null }).schedule.kind).toBe('folga');
    const sat = resolveScheduleDay(fiveByTwo, '2026-11-28', { isDayOff: false, startTime: '08:00', endTime: '12:00' });
    expect(sat.schedule).toEqual({ kind: 'trabalho', expectedPunches: ['2026-11-28T08:00', '2026-11-28T12:00'] });
  });

  it('saída antes da entrada sem vira_dia também cai no dia seguinte', () => {
    const def: ScheduleDef = { ...fiveByTwo, days: [weekday(1, { startTime: '22:00', endTime: '05:00', breakStartTime: null, breakEndTime: null })] };
    const r = resolveScheduleDay(def, '2026-11-23');
    expect(r.schedule).toEqual({ kind: 'trabalho', expectedPunches: ['2026-11-23T22:00', '2026-11-24T05:00'] });
    expect(r.plannedMinutes).toBe(420);
  });
});
