/** Contratos HTTP de escala (G2, RF07 a RF12). */
import { z } from 'zod';
import { civilDate, positiveId } from '../../http/schemas';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:mm');

export const scheduleDayInput = z
  .object({
    position: z.number().int().min(0).max(59),
    isDayOff: z.boolean().default(false),
    startTime: time.nullable().optional(),
    endTime: time.nullable().optional(),
    breakStartTime: time.nullable().optional(),
    breakEndTime: time.nullable().optional(),
    crossesMidnight: z.boolean().default(false),
  })
  .refine((d) => (d.isDayOff ? !d.startTime && !d.endTime : !!d.startTime && !!d.endTime), {
    message: 'folga não tem horário; dia de trabalho tem entrada e saída',
  })
  .refine((d) => !!d.breakStartTime === !!d.breakEndTime, { message: 'intervalo precisa de início e fim' });

const scheduleBase = z.object({
  establishmentId: positiveId,
  name: z.string().trim().min(2).max(100),
  type: z.enum(['5x2', '6x1', '12x36', 'livre']),
  cycleType: z.enum(['semanal', 'ciclico']),
  cycleDays: z.number().int().min(2).max(60).nullable().optional(),
  referenceDate: civilDate.nullable().optional(),
  weeklyMinutes: z.number().int().positive().max(7 * 24 * 60),
  days: z.array(scheduleDayInput).min(1).max(60),
});

function coherent(b: { cycleType?: 'semanal' | 'ciclico'; cycleDays?: number | null; referenceDate?: string | null; days?: { position: number }[] }, ctx: z.RefinementCtx) {
  if (b.cycleType === 'semanal' && (b.cycleDays || b.referenceDate)) {
    ctx.addIssue({ code: 'custom', path: ['cycleDays'], message: 'escala semanal não tem ciclo nem data de referência' });
  }
  if (b.cycleType === 'ciclico' && (!b.cycleDays || !b.referenceDate)) {
    ctx.addIssue({ code: 'custom', path: ['cycleDays'], message: 'escala cíclica precisa de ciclo e data de referência' });
  }
  if (b.days) {
    const max = b.cycleType === 'ciclico' ? (b.cycleDays ?? 0) - 1 : 6;
    const positions = b.days.map((d) => d.position);
    if (new Set(positions).size !== positions.length) ctx.addIssue({ code: 'custom', path: ['days'], message: 'posição repetida' });
    if (positions.some((p) => p > max)) ctx.addIssue({ code: 'custom', path: ['days'], message: `posição deve ir de 0 a ${max}` });
  }
}

export const createScheduleBody = scheduleBase.superRefine(coherent);

/** Troca nome, carga e dias (todos os `dias_escala` são substituídos). Tipo e ciclo não mudam. */
export const updateScheduleBody = z
  .object({
    name: scheduleBase.shape.name,
    weeklyMinutes: scheduleBase.shape.weeklyMinutes,
    days: scheduleBase.shape.days,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

export const listSchedulesQuery = z.object({ establishmentId: positiveId.optional() });

const scheduleDayDto = z.object({
  position: z.number(),
  isDayOff: z.boolean(),
  startTime: z.string().nullable(),
  endTime: z.string().nullable(),
  breakStartTime: z.string().nullable(),
  breakEndTime: z.string().nullable(),
  crossesMidnight: z.boolean(),
});

const warningDto = z.object({
  /** Data em que a regra de jornada usada passa a valer (RF11: aviso antes da troca). */
  ruleValidFrom: z.string(),
  code: z.enum(['carga_semanal_acima_limite', 'folgas_abaixo_minimo']),
  plannedMinutes: z.number().optional(),
  maxMinutes: z.number().optional(),
  restDays: z.number().optional(),
  minRestDays: z.number().optional(),
});

export const scheduleDto = z.object({
  id: z.number(),
  establishmentId: z.number(),
  name: z.string(),
  type: z.string(),
  cycleType: z.string(),
  cycleDays: z.number().nullable(),
  referenceDate: z.string().nullable(),
  weeklyMinutes: z.number(),
  days: z.array(scheduleDayDto),
  /** Só avisa, nunca bloqueia (RN06, art. 74). */
  warnings: z.array(warningDto),
});

export const scheduleResponse = z.object({ data: scheduleDto });
export const scheduleListResponse = z.object({ data: z.array(scheduleDto.omit({ days: true, warnings: true })) });

export const assignScheduleBody = z
  .object({ scheduleId: positiveId, validFrom: civilDate, validTo: civilDate.nullable().optional() })
  .refine((b) => !b.validTo || b.validTo >= b.validFrom, { path: ['validTo'], message: 'fim antes do início' });

export const employeeScheduleDto = z.object({
  id: z.number(),
  employeeId: z.number(),
  scheduleId: z.number(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});
export const employeeScheduleResponse = z.object({ data: employeeScheduleDto });
export const employeeScheduleListResponse = z.object({ data: z.array(employeeScheduleDto) });
