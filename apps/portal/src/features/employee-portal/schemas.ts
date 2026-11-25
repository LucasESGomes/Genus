/** Formulários do portal do funcionário (zod v4). As regras de faixa copiam as da api; a api valida de novo. */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import { DEFAULT_TZ } from '@/lib/format';
import { CERTIFICATE_TYPES, MAX_CERTIFICATE_BYTES } from './copy';

const civil = (msg: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg);

/** `abono` não é oferecido ao funcionário. [A CONFIRMAR] com o back: /me/adjustments aceita os 3 tipos. */
export const EMPLOYEE_ADJUSTMENT_TYPES = ['inclusao_batida', 'justificativa'] as const;

export const adjustmentSchema = z
  .object({
    date: civil('Escolha a data.'),
    type: z.enum(EMPLOYEE_ADJUSTMENT_TYPES),
    time: z.string(),
    reason: z.string().trim().min(3, 'Escreva o motivo, com pelo menos 3 letras.').max(500, 'O motivo pode ter até 500 letras.'),
  })
  .refine((v) => v.type !== 'inclusao_batida' || /^\d{2}:\d{2}$/.test(v.time), { path: ['time'], message: 'Informe o horário da marcação.' });
export type AdjustmentForm = z.input<typeof adjustmentSchema>;

/** Instante ISO com o fuso do estabelecimento (-03:00). */
export function proposedAtOf(date: string, time: string): string {
  return formatInTimeZone(fromZonedTime(`${date}T${time}:00`, DEFAULT_TZ), DEFAULT_TZ, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

export const vacationSchema = z
  .object({
    accrualPeriodId: z.string().min(1, 'Escolha o período.'),
    startDate: civil('Escolha o primeiro dia.'),
    endDate: civil('Escolha o último dia.'),
    cashBonusDays: z.string().regex(/^\d{1,2}$/, 'Informe de 0 a 10 dias.'),
  })
  .refine((v) => Number(v.cashBonusDays) <= 10, { path: ['cashBonusDays'], message: 'Informe de 0 a 10 dias.' })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'O último dia não pode ser antes do primeiro.' });
export type VacationForm = z.input<typeof vacationSchema>;

export const certificateSchema = z
  .object({
    file: z.instanceof(File, { message: 'Escolha a foto ou o arquivo do atestado.' }),
    startDate: civil('Informe o primeiro dia de afastamento.'),
    unit: z.enum(['dias', 'horas']),
    amount: z.string().trim(),
    doctorName: z.string().trim().max(200, 'Use até 200 letras.'),
    doctorCrm: z.string().trim().regex(/^\d*$/, 'Só os números do CRM.'),
    doctorCrmUf: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Use a sigla do estado, como SP.'),
  })
  .superRefine((v, ctx) => {
    const max = v.unit === 'dias' ? 365 : 24;
    const n = Number(v.amount);
    if (!/^\d+$/.test(v.amount) || n < 1 || n > max) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: `Informe de 1 a ${max} ${v.unit}.` });
    }
    if (v.file.size > MAX_CERTIFICATE_BYTES) ctx.addIssue({ code: 'custom', path: ['file'], message: 'O arquivo passa de 10 MB. Tire uma foto menor.' });
    else if (!CERTIFICATE_TYPES.includes(v.file.type)) ctx.addIssue({ code: 'custom', path: ['file'], message: 'Envie o atestado em foto (JPEG ou PNG) ou em PDF.' });
  });
export type CertificateForm = z.input<typeof certificateSchema>;
