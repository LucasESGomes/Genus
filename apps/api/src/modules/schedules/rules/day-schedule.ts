/**
 * Escala do dia (G2, RF07 a RF12): de `escalas` + `dias_escala` + `trocas_turno`
 * para o que a apuração espera do dia (`DaySchedule` de timesheets/rules/day.ts).
 * Função pura e determinística (RNF05).
 *
 * - Escala semanal: `posicao` é o dia da semana, 0 = domingo ... 6 = sábado.
 * - Escala cíclica (12x36 etc.): `posicao` = dias desde `data_referencia`, módulo `ciclo_dias`.
 * - Dia sem linha em `dias_escala` = folga.
 * - Troca de turno do dia substitui a escala (sem intervalo previsto).
 * - Saída depois da meia-noite (`vira_dia`, ou saída antes da entrada) cai no dia seguinte.
 */
import type { DaySchedule } from '../../timesheets/rules/day';
import {
  addDays,
  diffDays,
  isoWeekday,
  timeOfDayMinutes,
  type CivilDate,
  type LocalDateTime,
  type TimeOfDay,
} from '../../rules-common/rules/civil-time';

export interface ScheduleDayDef {
  position: number;
  isDayOff: boolean;
  startTime: TimeOfDay | null;
  endTime: TimeOfDay | null;
  breakStartTime: TimeOfDay | null;
  breakEndTime: TimeOfDay | null;
  crossesMidnight: boolean;
}

export interface ScheduleDef {
  cycleType: 'semanal' | 'ciclico';
  cycleDays: number | null;
  referenceDate: CivilDate | null;
  days: readonly ScheduleDayDef[];
}

export interface ScheduleOverride {
  isDayOff: boolean;
  startTime: TimeOfDay | null;
  endTime: TimeOfDay | null;
}

export function positionFor(def: ScheduleDef, date: CivilDate): number {
  if (def.cycleType === 'semanal') return isoWeekday(date) % 7;
  const n = def.cycleDays as number;
  const d = diffDays(def.referenceDate as CivilDate, date);
  return ((d % n) + n) % n;
}

const at = (date: CivilDate, time: TimeOfDay): LocalDateTime => `${date}T${time}`;

/** Horário `time` no dia `date` ou no seguinte, o que vier depois de `after` (em minutos do dia). */
function after(date: CivilDate, time: TimeOfDay, afterMinute: number, forceNextDay = false): LocalDateTime {
  return forceNextDay || timeOfDayMinutes(time) <= afterMinute ? at(addDays(date, 1), time) : at(date, time);
}

export interface ResolvedScheduleDay {
  schedule: DaySchedule;
  /** Previsto em minutos de relógio (soma dos pares), para o aviso de carga semanal. */
  plannedMinutes: number;
  /** A saída prevista cai no dia seguinte. */
  crossesMidnight: boolean;
}

export function resolveScheduleDay(def: ScheduleDef, date: CivilDate, override: ScheduleOverride | null = null): ResolvedScheduleDay {
  let start: TimeOfDay | null;
  let end: TimeOfDay | null;
  let breakStart: TimeOfDay | null = null;
  let breakEnd: TimeOfDay | null = null;
  let forceNext = false;

  if (override) {
    if (override.isDayOff) return { schedule: { kind: 'folga' }, plannedMinutes: 0, crossesMidnight: false };
    start = override.startTime;
    end = override.endTime;
  } else {
    const pos = positionFor(def, date);
    const day = def.days.find((d) => d.position === pos);
    if (!day || day.isDayOff) return { schedule: { kind: 'folga' }, plannedMinutes: 0, crossesMidnight: false };
    start = day.startTime;
    end = day.endTime;
    breakStart = day.breakStartTime;
    breakEnd = day.breakEndTime;
    forceNext = day.crossesMidnight;
  }
  const s = start as TimeOfDay;
  const e = end as TimeOfDay;
  const startMin = timeOfDayMinutes(s);
  const expected: LocalDateTime[] = [at(date, s)];
  if (breakStart && breakEnd) {
    expected.push(after(date, breakStart, startMin));
    expected.push(after(date, breakEnd, startMin));
  }
  const endAt = after(date, e, startMin, forceNext);
  expected.push(endAt);

  const minutes = (x: LocalDateTime) => diffDays(date, x.slice(0, 10)) * 1440 + timeOfDayMinutes(x.slice(11));
  let planned = 0;
  for (let i = 0; i + 1 < expected.length; i += 2) planned += minutes(expected[i + 1] as string) - minutes(expected[i] as string);
  return {
    schedule: { kind: 'trabalho', expectedPunches: expected },
    plannedMinutes: planned,
    crossesMidnight: endAt.slice(0, 10) !== date,
  };
}
