/** Contratos HTTP de feriados (G3, RF14 a RF16). */
import { z } from 'zod';
import { civilDate, positiveId } from '../../http/schemas';

export const listHolidaysQuery = z.object({ establishmentId: positiveId, year: z.coerce.number().int().min(2000).max(2100) });

/**
 * Feriado da conta. `nacional` = vale para todos os estabelecimentos da conta; `estadual` e
 * `municipal` usam a UF e o município do estabelecimento informado.
 */
export const createHolidayBody = z.object({
  establishmentId: positiveId,
  date: civilDate,
  name: z.string().trim().min(2).max(120),
  scope: z.enum(['nacional', 'estadual', 'municipal']),
  isOptional: z.boolean().default(false),
});

export const updateHolidayBody = z
  .object({ date: civilDate, name: z.string().trim().min(2).max(120), isOptional: z.boolean() })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'envie ao menos um campo');

export const establishmentHolidayParams = z.object({ id: positiveId, holidayId: positiveId });

/** RF16: o estabelecimento trabalha no feriado? Se trabalha, como trata a hora. */
export const setEstablishmentHolidayBody = z
  .object({ isWorked: z.boolean(), treatment: z.enum(['pagar_100', 'banco_horas']).nullable().optional() })
  .refine((b) => (b.isWorked ? !!b.treatment : !b.treatment), {
    path: ['treatment'],
    message: 'quem trabalha no feriado escolhe o tratamento; quem não trabalha não tem tratamento',
  });

export const holidayDto = z.strictObject({
  id: z.number(),
  date: z.string(),
  name: z.string(),
  scope: z.enum(['nacional', 'estadual', 'municipal']),
  uf: z.string().nullable(),
  municipalityIbge: z.string().nullable(),
  /** Facultativo não muda a apuração. */
  isOptional: z.boolean(),
  /** Cadastrado pela conta (pode editar e remover); os demais são do catálogo oficial. */
  isOwn: z.boolean(),
  /** Do estabelecimento da consulta. */
  isWorked: z.boolean(),
  treatment: z.enum(['pagar_100', 'banco_horas']).nullable(),
});
export type HolidayDto = z.infer<typeof holidayDto>;

export const holidayResponse = z.object({ data: holidayDto });
export const holidayListResponse = z.object({ data: z.array(holidayDto) });
