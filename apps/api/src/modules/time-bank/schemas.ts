/**
 * Contratos HTTP do banco de horas (G8). `TimeBank` e `TimeBankBalanceRow` são
 * os que o portal consome (apps/portal/src/lib/api/contracts.ts).
 */
import { z } from 'zod';
import { civilDate, listMeta, pagination, positiveId } from '../../http/schemas';
import { searchText } from '../../http/search';

export const TIME_BANK_MODALITIES = ['individual_6m', 'coletivo_12m'] as const;

/** Peso de domingo ou feriado: texto com 2 casas, de "1.00" a "9.99". */
const weight = z.string().regex(/^[1-9]\.\d{2}$/, 'use de 1.00 a 9.99, com 2 casas');

export const timeBankResponse = z.object({
  data: z.object({
    balanceMinutes: z.number(),
    expiringIn30DaysMinutes: z.number(),
    entries: z.array(z.object({ date: z.string(), type: z.string(), minutes: z.number(), dueDate: z.string().nullable() })),
  }),
});
export type TimeBankDto = z.infer<typeof timeBankResponse>['data'];

export const balancesQuery = pagination.extend({
  establishmentId: positiveId,
  /** Nome ou matrícula (contém, sem diferenciar maiúsculas nem acento). */
  q: searchText.optional(),
});

export const balanceRowDto = z.object({
  employeeId: z.number(),
  employeeName: z.string(),
  departmentName: z.string().nullable(),
  balanceMinutes: z.number(),
  expiringIn30DaysMinutes: z.number(),
  nextDueDate: z.string().nullable(),
});
export const balanceListResponse = z.object({ data: z.array(balanceRowDto), meta: listMeta });

export const policyBody = z.object({
  modality: z.enum(TIME_BANK_MODALITIES),
  sundayWeight: weight,
  holidayWeight: weight,
  validFrom: civilDate,
});

export const policyDto = z.object({
  id: z.number(),
  establishmentId: z.number(),
  modality: z.enum(TIME_BANK_MODALITIES),
  sundayWeight: z.string(),
  holidayWeight: z.string(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
});
export type PolicyDto = z.infer<typeof policyDto>;

export const policyResponse = z.object({ data: policyDto });
export const currentPolicyResponse = z.object({ data: policyDto.nullable() });
