import { z } from 'zod';
import { TIME_BANK_MODALITIES, type TimeBankModality } from '@/lib/api/contracts';
import { COPY } from './copy';

/** Aceita "2", "1,5" ou "1.50" e entrega o texto da api, com 2 casas, sem passar por número de ponto flutuante. */
const weight = z
  .string()
  .trim()
  .regex(/^[1-9]([.,]\d{1,2})?$/, COPY.errorWeight)
  .transform((v) => {
    const [whole, cents = ''] = v.split(/[.,]/);
    return `${whole}.${cents.padEnd(2, '0')}`;
  });

/** Só formato: a regra de vigência é da api (409 BANCO_REGRA_VIGENCIA). */
export const policyFormSchema = z.object({
  modality: z.string().refine((v): v is TimeBankModality => (TIME_BANK_MODALITIES as readonly string[]).includes(v), COPY.errorModality),
  sundayWeight: weight,
  holidayWeight: weight,
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, COPY.errorValidFrom),
});
