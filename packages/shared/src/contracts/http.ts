/** Envelope de erro e saúde, comuns às APIs do Genus (backend.md §6). */
import { z } from 'zod';

export const ERROR_CODES = [
  'UNAUTHORIZED',
  'CHAVE_APARELHO_INVALIDA',
  'VALIDATION_ERROR',
  'INVALID_IMAGE',
  'IMAGE_TOO_LARGE',
  'NOT_FOUND',
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

export const DEPENDENCY_STATUSES = ['ok', 'degraded', 'down'] as const;
export const dependencyStatusSchema = z.enum(DEPENDENCY_STATUSES);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

/** GET /health: sempre 200 enquanto o processo responde; detalha dependências. */
export const healthResponseSchema = z.object({
  data: z.object({
    status: dependencyStatusSchema,
    checks: z.object({
      api: z.literal('ok'),
      database: dependencyStatusSchema,
      engine: dependencyStatusSchema,
    }),
  }),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/**
 * GET /health/ready: 200 se o Postgres responde (a API consegue gravar); 503
 * caso contrário. A engine NÃO entra no ready: sem engine a API continua útil
 * (responde `fallback_required`), e tirá-la do balanceador seria pior.
 */
export const readyResponseSchema = z.object({
  /** `queue` é informativo: o Valkey fora não derruba a prontidão (a batida grava e o resgate enfileira). */
  data: z.object({ ready: z.boolean(), queue: z.enum(['ok', 'down']) }),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;
