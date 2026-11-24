/** Contratos HTTP de ajuste de marcação (G5, RF23 a RF26). */
import { z } from 'zod';
import { civilDate, isoInstant, listMeta, pagination, positiveId, reasonText } from '../../http/schemas';

export const ADJUSTMENT_TYPES = ['inclusao_batida', 'justificativa', 'abono'] as const;
export const ADJUSTMENT_STATUSES = ['pendente', 'aprovado', 'recusado'] as const;

export const createAdjustmentBody = z
  .object({
    date: civilDate,
    type: z.enum(ADJUSTMENT_TYPES),
    /** Só na inclusão de batida: o instante proposto (com fuso). */
    proposedAt: isoInstant.optional(),
    reason: reasonText,
  })
  .refine((b) => b.type !== 'inclusao_batida' || !!b.proposedAt, { path: ['proposedAt'], message: 'inclusão de batida exige o horário' })
  .refine((b) => b.type === 'inclusao_batida' || !b.proposedAt, { path: ['proposedAt'], message: 'só a inclusão de batida tem horário' });

export const listAdjustmentsQuery = pagination.extend({
  status: z.enum(ADJUSTMENT_STATUSES).optional(),
  employeeId: positiveId.optional(),
});

export const approveBody = z.object({ note: reasonText.optional() });
export const rejectBody = z.object({ reason: reasonText });

export const adjustmentDto = z.object({
  id: z.number(),
  employeeId: z.number(),
  date: z.string(),
  type: z.enum(ADJUSTMENT_TYPES),
  proposedAt: z.string().nullable(),
  reason: z.string(),
  status: z.enum(ADJUSTMENT_STATUSES),
  requestedById: z.number(),
  requestedAt: z.string(),
  decidedById: z.number().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
});
export const adjustmentResponse = z.object({ data: adjustmentDto });
export const adjustmentListResponse = z.object({ data: z.array(adjustmentDto), meta: listMeta });
