/**
 * Cliente HTTP do face-engine (contrato conferido em services/face-engine).
 *
 * Regra de ouro: engine fora, lenta ou degradada vira `fallback` (o aparelho
 * pedirá PIN); a marcação NUNCA é bloqueada. A exceção são erros de integridade
 * (InvalidTag / DEK que não decifra): lançam `EngineIntegrityError` e jamais
 * viram "não identificado".
 */
import {
  ENGINE_MAX_CANDIDATES,
  EngineIntegrityError,
  engineHealthResponseSchema,
  engineRecognizeResponseSchema,
  type EngineRecognizeStatus,
  type EngineTiming,
  type EngineClient,
  type EngineWireCandidate,
  type FallbackReason,
  type Logger,
  type RecognizeRequest,
  type RecognizeResult,
} from '@genus/shared';
import { Semaphore } from './semaphore';

export interface HttpEngineClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Prazo total (fila + HTTP) por reconhecimento. */
  timeoutMs: number;
  maxConcurrency: number;
  logger: Logger;
  /** Validade do estado de saúde em cache. */
  healthTtlMs?: number;
  fetchImpl?: typeof fetch;
}

type HealthState = 'ok' | 'degraded' | 'down';

const STATUS_TO_REASON: Record<
  Exclude<EngineRecognizeStatus, 'identified'>,
  FallbackReason
> = {
  face_not_recognized: 'not_recognized',
  liveness_failed: 'liveness_failed',
  no_face_detected: 'no_face',
  multiple_faces_detected: 'multiple_faces',
};

const DEK_ERROR_PREFIX = 'Erro ao descriptografar DEK';

export class HttpEngineClient implements EngineClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly healthTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly semaphore: Semaphore;
  private healthState: { state: HealthState; atMs: number } | null = null;
  private healthInflight: Promise<HealthState> | null = null;

  constructor(opts: HttpEngineClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs;
    this.logger = opts.logger;
    this.healthTtlMs = opts.healthTtlMs ?? 5000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.semaphore = new Semaphore(opts.maxConcurrency);
  }

  async health(): Promise<HealthState> {
    const cached = this.healthState;
    if (cached && performance.now() - cached.atMs <= this.healthTtlMs) return cached.state;
    this.healthInflight ??= this.fetchHealth().finally(() => {
      this.healthInflight = null;
    });
    return this.healthInflight;
  }

  async recognize(req: RecognizeRequest): Promise<RecognizeResult> {
    const startedAt = performance.now();
    const deadline = startedAt + this.timeoutMs;
    const timing: EngineTiming = { roundTripMs: null, queueMs: 0, processingMs: null, stages: null };
    const fallback = (reason: FallbackReason): RecognizeResult => ({ kind: 'fallback', reason, timing });

    if (req.candidates.length > ENGINE_MAX_CANDIDATES) {
      this.logger.debug({ candidates: req.candidates.length }, 'engine: candidatos acima do teto');
      return fallback('too_many_candidates');
    }

    const health = await this.health();
    if (health === 'degraded') return fallback('engine_degraded');
    if (health === 'down') return fallback('engine_unavailable');

    const queueStart = performance.now();
    const acquired = await this.semaphore.acquire(deadline - queueStart);
    timing.queueMs = round(performance.now() - queueStart);
    if (!acquired) {
      this.logger.warn({ queueMs: timing.queueMs, traceId: req.traceId }, 'engine: prazo estourou na fila');
      return fallback('engine_unavailable');
    }

    const controller = new AbortController();
    const remaining = deadline - performance.now();
    const timer = setTimeout(() => controller.abort(), Math.max(remaining, 0));
    const httpStart = performance.now();
    try {
      if (remaining <= 0) return fallback('engine_unavailable');
      let res: Response;
      let bodyText: string;
      try {
        res = await this.fetchImpl(`${this.baseUrl}/recognize`, {
          method: 'POST',
          headers: { 'X-API-Key': this.apiKey },
          body: buildForm(req),
          signal: controller.signal,
        });
        bodyText = await res.text();
      } catch (err) {
        timing.roundTripMs = round(performance.now() - httpStart);
        this.logger.warn(
          { aborted: controller.signal.aborted, roundTripMs: timing.roundTripMs, traceId: req.traceId, err: errorName(err) },
          'engine: falha de rede ou timeout',
        );
        return fallback('engine_unavailable');
      }
      timing.roundTripMs = round(performance.now() - httpStart);
      this.logger.debug(
        { httpStatus: res.status, candidates: req.candidates.length, roundTripMs: timing.roundTripMs, queueMs: timing.queueMs, traceId: req.traceId },
        'engine: resposta de /recognize',
      );

      if (res.status >= 500) return fallback('engine_unavailable');
      if (res.status !== 200) return fallback(this.rejectNon200(res.status, bodyText, req));

      const parsed = engineRecognizeResponseSchema.safeParse(safeJson(bodyText));
      if (!parsed.success) {
        // Fora do contrato: a marcação não pode ser bloqueada; o aparelho segue pelo PIN.
        this.logger.error({ httpStatus: 200, traceId: req.traceId }, 'engine: resposta 200 fora do contrato');
        return fallback('engine_unavailable');
      }
      const body = parsed.data;
      timing.processingMs = body.processing_ms;
      timing.stages = body.timings_ms ?? null;

      if (body.status === 'liveness_failed') {
        return { kind: 'fallback', reason: 'liveness_failed', livenessScore: body.liveness_combined_raw ?? null, timing };
      }
      if (body.status !== 'identified') return fallback(STATUS_TO_REASON[body.status]);

      const employeeId = Number(body.person_id);
      if (
        body.person_id === null ||
        body.person_id === undefined ||
        !Number.isFinite(employeeId) ||
        !req.candidates.some((c) => c.employeeId === employeeId)
      ) {
        // Nunca registrar pessoa que não estava na lista enviada; o aparelho segue pelo PIN.
        this.logger.error({ traceId: req.traceId }, 'engine: identificou pessoa fora da lista de candidatos');
        return fallback('engine_unavailable');
      }
      return {
        kind: 'identified',
        employeeId,
        recognitionScore: body.confidence ?? null,
        livenessScore: body.liveness_combined_raw ?? null,
        timing,
      };
    } finally {
      clearTimeout(timer);
      this.semaphore.release();
    }
  }

  /**
   * Resposta não 200 e não 5xx. Integridade criptográfica (422 InvalidTag, ou
   * 400 de DEK) LANÇA e nunca vira "não identificado". Qualquer outra (400 de
   * imagem não decodificável, 401 de chave errada, 413/429 de proxy) é logada
   * como erro e vira fallback: o sistema nunca bloqueia a marcação.
   * O `detail` da engine não vai ao log (pode conter texto de exceção).
   */
  private rejectNon200(status: number, bodyText: string, req: RecognizeRequest): FallbackReason {
    const detail = extractDetail(bodyText);
    if (status === 422 || (status === 400 && detail.startsWith(DEK_ERROR_PREFIX))) {
      this.logger.error(
        {
          severity: 'critical',
          httpStatus: status,
          tenantId: req.tenantId,
          traceId: req.traceId,
          candidates: req.candidates.length,
          kind: status === 422 ? 'embedding_invalid_tag' : 'dek_decrypt_failed',
        },
        'engine: falha de integridade criptográfica (InvalidTag / DEK)',
      );
      throw new EngineIntegrityError(`Engine rejeitou a criptografia (HTTP ${status})`);
    }
    this.logger.error(
      { httpStatus: status, traceId: req.traceId, severity: status === 401 || status === 403 ? 'high' : 'medium' },
      'engine: resposta fora do contrato; seguindo com fallback',
    );
    return 'engine_unavailable';
  }

  private async fetchHealth(): Promise<HealthState> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let state: HealthState = 'down';
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, { signal: controller.signal });
      const parsed = engineHealthResponseSchema.safeParse(safeJson(await res.text()));
      if (res.status === 200 && parsed.success) state = parsed.data.status;
    } catch (err) {
      this.logger.warn({ err: errorName(err) }, 'engine: /health inacessível');
    } finally {
      clearTimeout(timer);
    }
    this.healthState = { state, atMs: performance.now() };
    this.logger.debug({ state }, 'engine: estado de saúde atualizado');
    return state;
  }
}

function buildForm(req: RecognizeRequest): FormData {
  const wire: EngineWireCandidate[] = req.candidates.map((c) => ({
    person_id: c.employeeId,
    embedding_iv: c.embedding.ivHex,
    embedding_tag: c.embedding.tagHex,
    embedding_ct: c.embedding.ciphertextHex,
    key_version: c.embedding.keyVersion,
  }));
  const form = new FormData();
  form.append('tenant_id', req.tenantId);
  form.append('image', new Blob([new Uint8Array(req.image)], { type: req.imageMime }), 'frame');
  form.append('candidates', JSON.stringify(wire));
  form.append('dek_ct', req.tenantDek.ciphertextHex);
  form.append('dek_iv', req.tenantDek.ivHex);
  form.append('dek_tag', req.tenantDek.tagHex);
  form.append('dek_key_version', String(req.tenantDek.keyVersion));
  form.append('trace_id', req.traceId);
  // Limiares calibrados do aparelho; NULL = a engine usa o padrão dela (o campo nem vai).
  if (req.recognitionThreshold != null) form.append('recognition_threshold', String(req.recognitionThreshold));
  if (req.livenessThreshold != null) form.append('liveness_threshold', String(req.livenessThreshold));
  return form;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractDetail(text: string): string {
  const json = safeJson(text);
  if (json && typeof json === 'object' && 'detail' in json && typeof json.detail === 'string') {
    return json.detail;
  }
  return '';
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown';
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}
