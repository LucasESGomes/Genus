/**
 * Escala vigente de cada colaborador por dia (vínculo + dias da escala + troca de
 * turno) e o instante em que a janela do dia encerra. Usado pela apuração e pelo
 * encerramento automático (`close-days`), para os dois concordarem.
 *
 * Batida depois da meia-noite: se a escala do dia vira o dia, a janela vai até
 * 4 h depois da saída prevista [A CONFIRMAR]; senão, até a meia-noite local.
 */
import { and, between, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { employeeSchedules, scheduleOverrides, schedules } from '../../db/schema';
import { addDays, type CivilDate, type LocalDateTime } from '../rules-common/rules/civil-time';
import { localToInstant } from '../rules-common/rules/timezone';
import { resolveScheduleDay, type ResolvedScheduleDay, type ScheduleDayDef, type ScheduleDef } from '../schedules/rules/day-schedule';
import { loadScheduleDays } from '../schedules/service';

/** Quanto depois da saída prevista uma batida ainda conta para o dia que virou [A CONFIRMAR]. */
const CROSS_MIDNIGHT_GRACE_MS = 4 * 60 * 60 * 1000;

export interface EmployeeDaySchedule {
  scheduleId: number;
  resolved: ResolvedScheduleDay;
}

/** null = colaborador sem escala vigente no dia. */
export type ScheduleResolver = (employeeId: number, date: CivilDate) => EmployeeDaySchedule | null;

/** Resolve os dias de `from` a `to` (inclusive) dos colaboradores dados, todos da mesma conta. */
export async function loadScheduleResolver(
  ex: Executor,
  tenantId: number,
  employeeIds: number[],
  from: CivilDate,
  to: CivilDate,
): Promise<ScheduleResolver> {
  if (employeeIds.length === 0) return () => null;
  const assignments = await ex
    .select({
      employeeId: employeeSchedules.employeeId,
      scheduleId: employeeSchedules.scheduleId,
      validFrom: employeeSchedules.validFrom,
      validTo: employeeSchedules.validTo,
      cycleType: schedules.cycleType,
      cycleDays: schedules.cycleDays,
      referenceDate: schedules.referenceDate,
    })
    .from(employeeSchedules)
    .innerJoin(schedules, and(eq(schedules.tenantId, employeeSchedules.tenantId), eq(schedules.id, employeeSchedules.scheduleId)))
    .where(
      and(
        eq(employeeSchedules.tenantId, tenantId),
        inArray(employeeSchedules.employeeId, employeeIds),
        lte(employeeSchedules.validFrom, to),
        or(isNull(employeeSchedules.validTo), gte(employeeSchedules.validTo, from)),
      ),
    );
  const dayCache = new Map<number, ScheduleDayDef[]>();
  for (const a of assignments) {
    if (!dayCache.has(a.scheduleId)) dayCache.set(a.scheduleId, await loadScheduleDays(ex, tenantId, a.scheduleId));
  }
  const overrides = await ex
    .select()
    .from(scheduleOverrides)
    .where(and(eq(scheduleOverrides.tenantId, tenantId), inArray(scheduleOverrides.employeeId, employeeIds), between(scheduleOverrides.date, from, to)));

  return (employeeId, date) => {
    const a = assignments.find((x) => x.employeeId === employeeId && x.validFrom <= date && (x.validTo === null || date <= x.validTo));
    if (!a) return null;
    const def: ScheduleDef = {
      cycleType: a.cycleType as ScheduleDef['cycleType'],
      cycleDays: a.cycleDays,
      referenceDate: a.referenceDate,
      days: dayCache.get(a.scheduleId) ?? [],
    };
    const o = overrides.find((x) => x.employeeId === employeeId && x.date === date);
    const override = o ? { isDayOff: o.isDayOff, startTime: o.startTime?.slice(0, 5) ?? null, endTime: o.endTime?.slice(0, 5) ?? null } : null;
    return { scheduleId: a.scheduleId, resolved: resolveScheduleDay(def, date, override) };
  };
}

/** Fim (exclusivo) da janela do dia, no fuso `tz`. A partir dele o dia está encerrado. */
export function dayEndsAt(date: CivilDate, day: EmployeeDaySchedule | null, tz: string): Date {
  const midnight = localToInstant(`${addDays(date, 1)}T00:00`, tz);
  if (day?.resolved.crossesMidnight && day.resolved.schedule.kind === 'trabalho') {
    const lastExpected = day.resolved.schedule.expectedPunches.at(-1) as LocalDateTime;
    return new Date(Math.max(midnight.getTime(), localToInstant(lastExpected, tz).getTime() + CROSS_MIDNIGHT_GRACE_MS));
  }
  return midnight;
}
