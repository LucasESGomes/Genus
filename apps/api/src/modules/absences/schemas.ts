/** Contratos HTTP de afastamento (G7, RF29 a RF31). */
import { z } from 'zod';
import { civilDate } from '../../http/schemas';

/** `atestado` não entra aqui: o afastamento por atestado nasce da aprovação do atestado. */
export const MANUAL_ABSENCE_TYPES = ['maternidade', 'paternidade', 'casamento', 'obito', 'doacao_sangue', 'alistamento', 'inss', 'outro'] as const;

export const createAbsenceBody = z
  .object({ type: z.enum(MANUAL_ABSENCE_TYPES), startDate: civilDate, endDate: civilDate })
  .refine((b) => b.endDate >= b.startDate, { path: ['endDate'], message: 'fim antes do início' });

export const absenceDto = z.object({
  id: z.number(),
  employeeId: z.number(),
  type: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  certificateId: z.number().nullable(),
});
export const absenceResponse = z.object({ data: absenceDto });
export const absenceListResponse = z.object({ data: z.array(absenceDto) });
