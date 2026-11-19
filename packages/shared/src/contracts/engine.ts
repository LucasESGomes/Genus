/**
 * Contrato do face-engine (services/face-engine), conferido no CÓDIGO
 * (app/api/routes/recognize.py, app/main.py), não na documentação antiga.
 *
 * O contrato da engine é em inglês e snake_case (herdado da Visage). Este
 * arquivo é o único lugar que conhece esse formato; o resto do código usa os
 * tipos camelCase de `interfaces.ts`.
 */
import { z } from 'zod';

/** Status reais devolvidos por POST /recognize (a doc antiga dizia `not_identified`). */
export const ENGINE_RECOGNIZE_STATUSES = [
  'identified',
  'face_not_recognized',
  'liveness_failed',
  'no_face_detected',
  'multiple_faces_detected',
] as const;
export const engineRecognizeStatusSchema = z.enum(ENGINE_RECOGNIZE_STATUSES);
export type EngineRecognizeStatus = z.infer<typeof engineRecognizeStatusSchema>;

/**
 * Corpo de resposta de POST /recognize (HTTP 200). Campos extras são ignorados.
 * `timings_ms` traz a duração de cada etapa (`dek_ms`, `image_decode_ms`,
 * `detection_ms`, `liveness_ms`, `hsv_ms`, `embedding_ms`,
 * `candidates_decrypt_ms`, `comparison_ms`, `total_ms`...) e contadores de
 * cache (`candidates_cache_hits`, `candidates_cache_misses`).
 */
export const engineRecognizeResponseSchema = z.object({
  status: engineRecognizeStatusSchema,
  person_id: z.union([z.number(), z.string()]).nullish(),
  confidence: z.number().nullish(),
  liveness_combined_raw: z.number().nullish(),
  best_distance_raw: z.number().nullish(),
  processing_ms: z.number(),
  timings_ms: z.record(z.string(), z.number()).nullish(),
});
export type EngineRecognizeResponse = z.infer<typeof engineRecognizeResponseSchema>;

/**
 * GET /health. `degraded` = algum modelo não carregou (ex.: liveness desligado).
 * Para batida, `degraded` é tratado como engine indisponível.
 */
export const engineHealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  models: z.record(z.string(), z.boolean()),
});
export type EngineHealthResponse = z.infer<typeof engineHealthResponseSchema>;

/** Resposta de POST /embeddings/register (usada só pelo script dev:enroll-fake). */
export const engineRegisterResponseSchema = z.object({
  person_id: z.number(),
  embedding_iv: z.string(),
  embedding_tag: z.string(),
  embedding_ct: z.string(),
  model_version: z.string(),
  images_processed: z.number(),
});
export type EngineRegisterResponse = z.infer<typeof engineRegisterResponseSchema>;

/**
 * Um candidato no campo multipart `candidates` (string JSON com uma lista destes).
 * Todos os binários em hex: IV 12 B, tag 16 B, ciphertext 2048 B (512 float32).
 */
export interface EngineWireCandidate {
  person_id: number | string;
  embedding_iv: string;
  embedding_tag: string;
  embedding_ct: string;
  key_version: number;
}

/**
 * Teto de candidatos por requisição: o Starlette limita cada campo multipart a
 * 1 MB e cada candidato em hex ocupa ~4,3 KB (medido: ~246). Acima disso a
 * engine responderia 400; o cliente recusa antes (`too_many_candidates`).
 */
export const ENGINE_MAX_CANDIDATES = 240;

/** Tamanhos fixos do envelope AES-256-GCM usado pela engine. */
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const AES_KEY_BYTES = 32;
export const EMBEDDING_DIMENSIONS = 512;
export const EMBEDDING_BYTES = EMBEDDING_DIMENSIONS * 4;
