/** Contratos HTTP de férias (G9, RF39 a RF43, RN10 a RN12). */
import { z } from 'zod';
import { civilDate, positiveId, reasonText } from '../../http/schemas';

export const VACATION_STATUSES = ['solicitada', 'aprovada', 'recusada', 'cancelada', 'gozada'] as const;

export const createAccrualPeriodBody = z.object({ startDate: civilDate });

export const requestVacationBody = z
  .object({
    accrualPeriodId: positiveId,
    startDate: civilDate,
    endDate: civilDate,
    cashBonusDays: z.number().int().min(0).max(10).default(0),
  })
  .refine((b) => b.endDate >= b.startDate, { path: ['endDate'], message: 'fim antes do início' });

export const rejectVacationBody = z.object({ reason: reasonText });

export const vacationDto = z.object({
  id: z.number(),
  accrualPeriodId: z.number(),
  employeeId: z.number(),
  departmentId: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  days: z.number(),
  cashBonusDays: z.number(),
  status: z.enum(VACATION_STATUSES),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  /** RN12: dias depois do fim do período concessivo (pagos em dobro). */
  daysPaidInDouble: z.number(),
});

export const accrualPeriodDto = z.object({
  id: z.number(),
  employeeId: z.number(),
  startDate: z.string(),
  endDate: z.string(),
  grantDeadline: z.string(),
  unjustifiedAbsences: z.number(),
  entitledDays: z.number(),
  status: z.string(),
  /** Direito menos o que já está aprovado ou gozado (dias + abono). */
  remainingDays: z.number(),
  vacations: z.array(vacationDto),
});

export const vacationResponse = z.object({ data: vacationDto });
export const accrualPeriodResponse = z.object({ data: accrualPeriodDto });
export const accrualPeriodListResponse = z.object({ data: z.array(accrualPeriodDto) });
