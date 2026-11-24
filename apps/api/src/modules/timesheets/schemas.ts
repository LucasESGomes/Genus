/** Contratos HTTP da apuração (G4, RF17 a RF22). */
import { z } from 'zod';
import { civilDate } from '../../http/schemas';
import { ISSUE_TYPES } from './issue-codes';

export const periodQuery = z.object({ from: civilDate, to: civilDate });
export const recalculateBody = periodQuery;

export const timesheetDayDto = z.object({
  date: z.string(),
  situation: z.string(),
  status: z.enum(['calculada', 'inconsistente']),
  scheduleId: z.number().nullable(),
  expectedMinutes: z.number(),
  workedMinutes: z.number(),
  absenceMinutes: z.number(),
  lateMinutes: z.number(),
  overtime50Minutes: z.number(),
  overtime100Minutes: z.number(),
  nightMinutes: z.number(),
  breakMinutes: z.number(),
  /** RNF06: as linhas de parâmetros legais usadas. */
  parameterVersion: z.string(),
  calculatedAt: z.string(),
  /** Visão resolvida do dia. A original fica no arp (só o NSR aqui) e nunca muda (RN01). */
  punches: z.array(
    z.object({
      sequence: z.number(),
      at: z.string(),
      origin: z.enum(['original', 'tratada']),
      nsr: z.number().nullable(),
      adjustmentId: z.number().nullable(),
    }),
  ),
  issues: z.array(z.object({ type: z.enum(ISSUE_TYPES), resolved: z.boolean() })),
});

export const timesheetListResponse = z.object({ data: z.array(timesheetDayDto) });
export const recalculateResponse = z.object({
  data: z.object({
    days: z.array(timesheetDayDto),
    /** Dias sem cálculo: sem escala vigente para o colaborador. */
    skipped: z.array(z.object({ date: z.string(), reason: z.enum(['sem_escala']) })),
  }),
});
