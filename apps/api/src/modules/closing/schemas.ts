/** Contratos HTTP de fechamento e espelho (G10, RF46 a RF49). */
import { z } from 'zod';
import { positiveId, reasonText } from '../../http/schemas';
import { timesheetDayDto } from '../timesheets/schemas';

export const CLOSING_STATUSES = ['aberto', 'fechado', 'reaberto'] as const;

export const listClosingsQuery = z.object({ establishmentId: positiveId.optional() });

export const createClosingBody = z.object({
  establishmentId: positiveId,
  /** Competência `YYYY-MM`: o período vai do dia 1 ao último dia do mês [A CONFIRMAR]. */
  referenceMonth: z.string().regex(/^20[0-9]{2}-(0[1-9]|1[0-2])$/, 'use AAAA-MM'),
});

export const reopenBody = z.object({ reason: reasonText });
export const closingMirrorParams = z.object({ id: positiveId, employeeId: positiveId });
export const myMirrorParams = z.object({ closingId: positiveId });

export const closingDto = z.object({
  id: z.number(),
  establishmentId: z.number(),
  referenceMonth: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(CLOSING_STATUSES),
  closedAt: z.string().nullable(),
  reopenedAt: z.string().nullable(),
  reopenReason: z.string().nullable(),
});

const totals = z.object({
  expectedMinutes: z.number(),
  workedMinutes: z.number(),
  absenceMinutes: z.number(),
  lateMinutes: z.number(),
  overtime50Minutes: z.number(),
  overtime100Minutes: z.number(),
  nightMinutes: z.number(),
});

/** Espelho em JSON (RF47). O PDF assinado depende do signer: `pdfUrl` fica nulo por ora. */
export const mirrorDto = z.object({
  closing: closingDto,
  employee: z.object({ id: z.number(), name: z.string(), cpf: z.string(), registrationNumber: z.string().nullable() }),
  days: z.array(timesheetDayDto),
  totals,
  timeBank: z.object({ balanceMinutes: z.number(), periodEntries: z.array(z.object({ date: z.string(), type: z.string(), minutes: z.number() })) }),
  pdfUrl: z.string().nullable(),
  acknowledgedAt: z.string().nullable(),
});

export const myMirrorSummaryDto = z.object({
  closingId: z.number(),
  referenceMonth: z.string(),
  status: z.enum(CLOSING_STATUSES),
  acknowledgedAt: z.string().nullable(),
});

export const closingResponse = z.object({ data: closingDto });
export const closingListResponse = z.object({ data: z.array(closingDto) });
export const mirrorResponse = z.object({ data: mirrorDto });
export const generateMirrorsResponse = z.object({ data: z.object({ generated: z.number(), total: z.number() }) });
export const myMirrorListResponse = z.object({ data: z.array(myMirrorSummaryDto) });
export const acknowledgeResponse = z.object({ data: z.object({ closingId: z.number(), acknowledgedAt: z.string() }) });
