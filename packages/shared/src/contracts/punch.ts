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
  /**
   * Id do job na fila `punches` (`<aparelhoId>-<sequencia>`). Determinístico: o
   * mesmo em todo reenvio e mesmo que a publicação tenha falhado (o resgate
   * publica com o mesmo id). Consulta: GET /coletor/batidas/jobs/:jobId.
   */
  jobId: z.string().regex(/^\d+-\d+$/),
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

// ---------------------------------------------------------------------------
// Status da batida: GET /coletor/batidas/jobs/:jobId e GET /coletor/batidas
// ---------------------------------------------------------------------------

/** `entradas.status`. Valor de enumeração do banco: não se traduz. */
export const ENTRY_STATUSES = ['pendente', 'processado', 'falhou'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/**
 * Estado do job no BullMQ. `not_found`: o job não está no Valkey (concluídos
 * saem em 24 h, ou nunca foi publicado e o resgate ainda não passou).
 * `unavailable`: o Valkey não respondeu ou a fila está desligada.
 */
export const QUEUE_JOB_STATES = [
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
  'active',
  'completed',
  'failed',
  'not_found',
  'unavailable',
] as const;
export type QueueJobState = (typeof QUEUE_JOB_STATES)[number];

/** Status de uma batida gravada. O banco é a fonte da verdade; sem CPF. */
export const punchStatusDtoSchema = z.object({
  jobId: z.string(),
  receiptId: z.uuid(),
  employeeId: z.number().int(),
  establishmentId: z.number().int(),
  deviceSequence: z.number().int(),
  /** `pendente` até o rep-core atribuir NSR; então `processado`. */
  status: z.enum(ENTRY_STATUSES),
  /** Tentativas do rep-core registradas no banco. */
  attempts: z.number().int(),
  /** NSR do registro fiscal; `null` enquanto não processada. */
  nsr: z.number().int().nullable(),
  markedAt: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
  warnings: z.array(punchWarningSchema),
});
export type PunchStatusDto = z.infer<typeof punchStatusDtoSchema>;

/** Status de UMA batida: inclui o estado do job no BullMQ, só para diagnóstico. */
export const punchStatusDetailDtoSchema = punchStatusDtoSchema.extend({
  queue: z.object({
    state: z.enum(QUEUE_JOB_STATES),
    /** Tentativas feitas pelo BullMQ; `null` quando o job não está no Valkey. */
    attemptsMade: z.number().int().nullable(),
  }),
});
export type PunchStatusDetailDto = z.infer<typeof punchStatusDetailDtoSchema>;

export const punchStatusResponseSchema = z.object({ data: punchStatusDetailDtoSchema });

export const PUNCH_LIST_MAX_PAGE_SIZE = 100;

export const punchListQuerySchema = z.object({
  employeeId: z.coerce
    .number({ error: 'employeeId deve ser um número inteiro' })
    .int('employeeId deve ser um número inteiro')
    .positive('employeeId deve ser maior que zero')
    .max(Number.MAX_SAFE_INTEGER),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(PUNCH_LIST_MAX_PAGE_SIZE).default(20),
});
export type PunchListQuery = z.infer<typeof punchListQuerySchema>;

export const punchListResponseSchema = z.object({
  data: z.array(punchStatusDtoSchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});

/** Tolerância entre `capturedAt` e o relógio do servidor antes de sinalizar. */
export const CLOCK_DIVERGENCE_TOLERANCE_MS = 30_000;
/** Janela em que a mesma pessoa batendo de novo gera `possible_duplicate`. */
export const DUPLICATE_WINDOW_MS = 60_000;
