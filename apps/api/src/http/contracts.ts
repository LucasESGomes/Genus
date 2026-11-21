/** Envelopes HTTP da api do portal (backend.md §6): sucesso `{ data }`, erro `{ error, code }`. */
import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  /** UNIQUE ou EXCLUDE do banco: já existe registro igual ou com período sobreposto. */
  'CONFLICT',
  /** CHECK, FK ou trigger de regra (ex.: setor desfalcado, período fechado). */
  'BUSINESS_RULE_VIOLATION',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** `{ error (pt-BR), code (UPPER_SNAKE) }`. Nunca stack, SQL ou texto de exceção. */
export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.enum(ERROR_CODES),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const healthResponseSchema = z.object({
  data: z.object({
    status: z.enum(['ok', 'down']),
    checks: z.object({ api: z.literal('ok'), database: z.enum(['ok', 'down']) }),
  }),
});

export const readyResponseSchema = z.object({
  data: z.object({ ready: z.boolean() }),
});
