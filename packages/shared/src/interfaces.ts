/**
 * Interfaces que separam a api do coletor das suas dependências. Cada uma tem
 * uma implementação provisória nesta entrega e será trocada depois sem mexer
 * na rota nem no service.
 */
import type { FallbackReason } from './contracts/punch.js';

// ---------------------------------------------------------------------------
// Cripto (formato compatível com services/face-engine/app/utils/crypto.py)
// ---------------------------------------------------------------------------

/** Envelope AES-256-GCM em hex, campos separados (IV 12 B, tag 16 B). */
export interface EncryptedHex {
  ivHex: string;
  tagHex: string;
  ciphertextHex: string;
}

/** DEK da conta cifrada com a MASTER_KEY (KEK). Vai à engine como dek_ct/dek_iv/dek_tag/dek_key_version. */
export interface EncryptedDek extends EncryptedHex {
  keyVersion: number;
}

/** Embedding (512 float32 = 2048 B, L2) cifrado com a DEK da conta. */
export interface EncryptedEmbedding extends EncryptedHex {
  keyVersion: number;
}

// ---------------------------------------------------------------------------
// Contexto do aparelho
// ---------------------------------------------------------------------------

/**
 * Quem está batendo. Vem do servidor (sessão/credencial do aparelho), NUNCA
 * do corpo da requisição.
 */
export interface DeviceContext {
  /** `conta_id` */
  tenantId: number;
  /** `estabelecimento_id` */
  establishmentId: number;
  /** `aparelho_id` */
  deviceId: number;
}

/**
 * Resolve o aparelho a partir da requisição já autenticada pela chave de
 * serviço. Implementação atual: valores fixos de configuração de dev.
 * Futuro: certificado mTLS / token do aparelho, validado contra o banco `app`.
 */
export interface DeviceAuthenticator {
  resolve(request: { headers: Record<string, string | string[] | undefined> }): Promise<DeviceContext>;
}

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

/** Pessoa que pode ser reconhecida neste aparelho. CPF só dígitos; nunca logar. */
export interface Candidate {
  /** `colaborador_id`; vai à engine como `person_id`. */
  employeeId: number;
  cpf: string;
  displayName: string;
  embedding: EncryptedEmbedding;
}

export interface CandidateSet {
  tenantDek: EncryptedDek;
  candidates: Candidate[];
}

/**
 * Fonte dos candidatos, SEMPRE no servidor (quem controlasse a lista poderia
 * forçar uma identificação). Atual: FakeCandidateProvider. Futuro: galeria do
 * estabelecimento no banco `app` (ou galeria residente na engine, /identify).
 */
export interface CandidateProvider {
  getCandidates(ctx: DeviceContext): Promise<CandidateSet>;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface RecognizeRequest {
  /** `conta_id` em texto (a engine usa string). */
  tenantId: string;
  image: Buffer;
  imageMime: string;
  candidates: Candidate[];
  tenantDek: EncryptedDek;
  /** `id_publico` pretendido da entrada, para amarrar os logs API ↔ engine. */
  traceId: string;
}

export interface EngineTiming {
  /** Ida e volta medida pelo cliente (inclui fila do semáforo). `null` se não houve chamada. */
  roundTripMs: number | null;
  /** Tempo de espera por vaga no semáforo. */
  queueMs: number;
  /** `processing_ms` da engine. */
  processingMs: number | null;
  /** `timings_ms` da engine, como veio. */
  stages: Record<string, number> | null;
}

export type RecognizeResult =
  | {
      kind: 'identified';
      employeeId: number;
      /** `confidence` da engine (0–1). */
      recognitionScore: number | null;
      /** `liveness_combined_raw` da engine (0–1). */
      livenessScore: number | null;
      timing: EngineTiming;
    }
  | {
      kind: 'fallback';
      reason: FallbackReason;
      timing: EngineTiming;
    };

/**
 * Cliente HTTP do face-engine. Regras:
 * - semáforo (ENGINE_MAX_CONCURRENCY) e timeout (ENGINE_TIMEOUT_MS) no cliente;
 * - mais candidatos que ENGINE_MAX_CANDIDATES → `fallback/too_many_candidates`, sem chamar;
 * - timeout, erro de rede, 5xx → `fallback/engine_unavailable`;
 * - /health `degraded` (cacheado por poucos segundos) → `fallback/engine_degraded`;
 * - HTTP 422 (InvalidTag do embedding) ou 400 "Erro ao descriptografar DEK" →
 *   lança EngineIntegrityError. NUNCA vira "não identificado";
 * - qualquer outra resposta fora do contrato → lança EngineProtocolError.
 */
export interface EngineClient {
  recognize(request: RecognizeRequest): Promise<RecognizeResult>;
  health(): Promise<'ok' | 'degraded' | 'down'>;
}

// ---------------------------------------------------------------------------
// Fila de batidas (BullMQ). Implementação: @genus/queue (docs/SPEC-nsr-fila.md §6).
// ---------------------------------------------------------------------------

/** Dados de uma batida gravada em `entradas`, o necessário para enfileirar. */
export interface PunchQueueEntry {
  /** `entradas.id` */
  entryId: number;
  /** `conta_id` */
  tenantId: number;
  /** `estabelecimento_id` */
  establishmentId: number;
  /** `aparelho_id`: só para montar o jobId, não vai no payload. */
  deviceId: number;
  /** `sequencia_aparelho`: só para montar o jobId, não vai no payload. */
  deviceSequence: number;
}

/**
 * Publica na fila `punches`. Chamado DEPOIS do COMMIT da entrada e fora da
 * transação. Quem chama decide o efeito de uma falha: a batida nunca é desfeita.
 */
export interface QueuePublisher {
  /** Lança em falha ou timeout. */
  publishPunch(entry: PunchQueueEntry): Promise<void>;
  /** Para `/health/ready`. Nunca lança. */
  ping(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/** Embedding ou DEK adulterado / chave errada. Log `fatal`/`error`, resposta 500. */
export class EngineIntegrityError extends Error {
  override readonly name = 'EngineIntegrityError';
}

/** A engine respondeu fora do contrato (401, 400 inesperado, JSON inválido). Resposta 500. */
export class EngineProtocolError extends Error {
  override readonly name = 'EngineProtocolError';
  readonly httpStatus: number | null;
  constructor(message: string, httpStatus: number | null) {
    super(message);
    this.httpStatus = httpStatus;
  }
}
