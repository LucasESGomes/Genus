/** Formulário "Novo ajuste" (zod v4). As faixas copiam as da api; a api valida de novo. */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import { ADJUSTMENT_TYPES } from '@/lib/api/contracts';
import { DEFAULT_TZ } from '@/lib/format';

export const createAdjustmentSchema = z
  .object({
    employeeId: z.string().min(1, 'Escolha o colaborador.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Escolha a data.'),
    type: z.enum(ADJUSTMENT_TYPES),
    time: z.string(),
    reason: z.string().trim().min(3, 'Escreva o motivo, com pelo menos 3 letras.').max(500, 'O motivo pode ter até 500 letras.'),
  })
  .refine((v) => v.type !== 'inclusao_batida' || /^\d{2}:\d{2}$/.test(v.time), { path: ['time'], message: 'Informe o horário da marcação.' });
export type CreateAdjustmentForm = z.input<typeof createAdjustmentSchema>;

/**
 * Instante ISO com o deslocamento do fuso do estabelecimento (ex.: -03:00).
 * [A CONFIRMAR] o fuso vem do estabelecimento quando o back mandar; até lá, DEFAULT_TZ.
 */
export function proposedAtOf(date: string, time: string, tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(fromZonedTime(`${date}T${time}:00`, tz), tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
