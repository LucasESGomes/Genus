/** Peças Zod comuns às rotas do portal. */
import { z } from 'zod';
import { dayNumber } from '../modules/rules-common/rules/civil-time';

/** `YYYY-MM-DD` que existe no calendário. */
export const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD')
  .refine((v) => {
    try {
      dayNumber(v);
      return true;
    } catch {
      return false;
    }
  }, 'data inexistente');

export const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const idParams = z.object({ id: positiveId });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const listMeta = z.object({ page: z.number(), pageSize: z.number(), total: z.number() });

/** Motivo (de quem pede) ou nota (de quem decide): texto livre, curto. */
export const reasonText = z.string().trim().min(3, 'escreva o motivo').max(500);

export const isoInstant = z.iso.datetime({ offset: true });
