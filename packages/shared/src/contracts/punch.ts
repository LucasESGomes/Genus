/**
 * Contrato público de POST /coletor/batidas (api do coletor).
 * JSON em camelCase inglês; valores de enumeração do banco ficariam em
 * português, mas aqui todos os valores são do protocolo (inglês).
 */
import { z } from 'zod';

/** Motivos pelos quais o aparelho deve seguir pelo fluxo alternativo (PIN). Nunca é erro. */
export const FALLBACK_REASONS = [
  'not_recognized',
  'liveness_failed',
  'no_face',
  'multiple_faces',
  'engine_unavailable',
  'engine_degraded',
  'too_many_candidates',
] as const;
export const fallbackReasonSchema = z.enum(FALLBACK_REASONS);
export type FallbackReason = z.infer<typeof fallbackReasonSchema>;

/** Sinalizações. Nunca impedem o registro (Portaria 671, art. 74/82). */
export const PUNCH_WARNINGS = ['clock_divergence', 'possible_duplicate'] as const;
export const punchWarningSchema = z.enum(PUNCH_WARNINGS);
export type PunchWarning = z.infer<typeof punchWarningSchema>;

export const PUNCH_OUTCOMES = ['registered', 'fallback_required'] as const;
export type PunchOutcome = (typeof PUNCH_OUTCOMES)[number];

/** Imagens aceitas. O mime declarado E os magic bytes precisam bater. */
export const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png'] as const;
export type AcceptedImageMime = (typeof ACCEPTED_IMAGE_MIMES)[number];

/**
 * Campos de texto do multipart (o arquivo `image` é validado à parte, por
 * tamanho, mime e magic bytes). Multipart entrega texto: `deviceSequence` é
 * convertido para inteiro.
 */
export const punchFieldsSchema = z.object({
  deviceSequence: z.coerce
    .number({ error: 'deviceSequence deve ser um número inteiro' })
    .int('deviceSequence deve ser um número inteiro')
    .positive('deviceSequence deve ser maior que zero')
    .max(Number.MAX_SAFE_INTEGER),
  capturedAt: z.iso.datetime({ offset: true, error: 'capturedAt deve ser data e hora ISO 8601' }),
});
export type PunchFields = z.infer<typeof punchFieldsSchema>;

/** Tempos (ms) de uma batida. `null` quando a etapa não aconteceu. */
export const punchTimingsSchema = z.object({
  validate: z.number(),
  candidates: z.number().nullable(),
  engineRoundTrip: z.number().nullable(),
  engineProcessing: z.number().nullable(),
  engineStages: z.record(z.string(), z.number()).nullable(),
  dbInsert: z.number().nullable(),
  total: z.number(),
});
export type PunchTimings = z.infer<typeof punchTimingsSchema>;

/** DTO de resposta: só o que sai do sistema. Sem CPF, sem ids internos. */
export const punchRegisteredDtoSchema = z.object({
  receiptId: z.uuid(),
  outcome: z.literal('registered'),
  markedAt: z.iso.datetime(),
  warnings: z.array(punchWarningSchema),
});
export const punchFallbackDtoSchema = z.object({
  outcome: z.literal('fallback_required'),
  reason: fallbackReasonSchema,
  warnings: z.array(punchWarningSchema),
});
export const punchResultDtoSchema = z.discriminatedUnion('outcome', [
  punchRegisteredDtoSchema,
  punchFallbackDtoSchema,
]);
export type PunchResultDto = z.infer<typeof punchResultDtoSchema>;

/** `{ data }`; `meta.timings` só quando EXPOSE_TIMINGS=true (nunca em prod). */
export const punchResponseSchema = z.object({
  data: punchResultDtoSchema,
  meta: z.object({ timings: punchTimingsSchema }).optional(),
});
export type PunchResponse = z.infer<typeof punchResponseSchema>;

/** Tolerância entre `capturedAt` e o relógio do servidor antes de sinalizar. */
export const CLOCK_DIVERGENCE_TOLERANCE_MS = 30_000;
/** Janela em que a mesma pessoa batendo de novo gera `possible_duplicate`. */
export const DUPLICATE_WINDOW_MS = 60_000;
