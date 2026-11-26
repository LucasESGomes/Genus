/**
 * Cliente da engine facial (serviço do ponto, NÃO alterado aqui): só chama a
 * interface que já existe, `POST /embeddings/register` (docs/face-engine.md §3).
 *
 * A engine recebe a DEK da empresa CIFRADA (como está em `chaves_empresa`),
 * decifra com a chave dela, gera o embedding médio das fotos e o devolve
 * cifrado com a mesma DEK. Esta api nunca vê a DEK em claro nem a MASTER_KEY.
 *
 * Nunca loga o `detail` da engine nem o embedding.
 */
import { z } from 'zod';
import { engineRegisterResponseSchema, type EncryptedDek, type EngineRegisterResponse } from '@genus/shared';

export interface EnrollImage {
  data: Buffer;
  mime: string;
}

export interface RegisterEmbeddingInput {
  engineTenantId: string;
  personId: number;
  images: readonly EnrollImage[];
  dek: EncryptedDek;
}

/** A engine recusou as fotos (sem rosto, imagem inválida): 400/422 da engine. */
export class EngineRejectedError extends Error {
  override readonly name = 'EngineRejectedError';
}

/** Engine fora do ar, timeout ou resposta fora do contrato. */
export class EngineUnavailableError extends Error {
  override readonly name = 'EngineUnavailableError';
}

/** Foto da calibração; o nome do arquivo (`p1_1.jpg`) agrupa as fotos por pessoa na engine. */
export interface CalibrationImage extends EnrollImage {
  filename: string;
}

/** Só o que a api usa do `RecognitionCalibrateResponse` da engine (POST /calibrate/recognition). */
export const engineRecognitionCalibrationSchema = z.object({
  recommended_threshold: z.number(),
  eer: z.number(),
  auc: z.number(),
  dprime: z.number(),
  confidence: z.enum(['low', 'medium', 'high']),
  warning: z.string().nullable().optional(),
  // opções de limiar por perfil (conservador, balanceado, liberal) e o recomendado
  recommended_profile: z.enum(['conservative', 'balanced', 'liberal']).optional(),
  options: z
    .array(
      z.object({
        profile: z.enum(['conservative', 'balanced', 'liberal']),
        profile_label: z.string(),
        threshold: z.number(),
        genuine_accept_rate: z.number(),
        impostor_reject_rate: z.number(),
        interpretation: z.string(),
      }),
    )
    .optional(),
  chart_data: z.object({
    histogram: z.array(z.object({ range_start: z.number(), range_end: z.number(), genuine_count: z.number(), impostor_count: z.number() })),
  }),
});
export type EngineRecognitionCalibration = z.infer<typeof engineRecognitionCalibrationSchema>;

/** Só o que a api usa do `CalibrateResponse` da engine (POST /calibrate/liveness). */
export const engineLivenessCalibrationSchema = z.object({
  suggested_thresholds: z.object({ liveness: z.number() }),
  liveness_analysis: z.object({
    real_pass_rate: z.number(),
    attack_block_rate: z.number(),
    youden_score: z.number(),
    confidence: z.enum(['low', 'medium', 'high']),
  }),
  warning: z.string().nullable().optional(),
});
export type EngineLivenessCalibration = z.infer<typeof engineLivenessCalibrationSchema>;

export interface FacialEngineClient {
  registerEmbedding(input: RegisterEmbeddingInput): Promise<EngineRegisterResponse>;
  /** `legitimate`: fotos `<pessoa>_<n>.jpg` de pelo menos 2 pessoas; `impostor`: de gente de fora. */
  calibrateRecognition(input: { legitimate: readonly CalibrationImage[]; impostor: readonly CalibrationImage[] }): Promise<EngineRecognitionCalibration>;
  /** `real`: rostos de verdade; `attack`: foto de rosto numa tela. */
  calibrateLiveness(input: { real: readonly CalibrationImage[]; attack: readonly CalibrationImage[] }): Promise<EngineLivenessCalibration>;
}

export interface HttpFacialEngineOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  /** As calibrações processam até 40 fotos; o padrão é bem maior que o do cadastro. */
  calibrationTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpFacialEngineClient implements FacialEngineClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: HttpFacialEngineOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  /**
   * Chamada comum às duas calibrações. Não envia a DEK: as rotas /calibrate da engine só a
   * decifram para o cache e não a usam no cálculo, então ela não precisa trafegar na URL.
   */
  private async postCalibration<T>(path: string, parts: Record<string, readonly CalibrationImage[]>, schema: z.ZodType<T>): Promise<T> {
    const form = new FormData();
    for (const [field, images] of Object.entries(parts)) {
      for (const img of images) form.append(field, new Blob([new Uint8Array(img.data)], { type: img.mime }), img.filename);
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.o.baseUrl.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: { 'X-API-Key': this.o.apiKey },
        body: form,
        signal: AbortSignal.timeout(this.o.calibrationTimeoutMs ?? 120_000),
      });
    } catch {
      throw new EngineUnavailableError('Engine facial indisponível');
    }
    if (res.status === 400 || res.status === 422) {
      await res.body?.cancel();
      throw new EngineRejectedError('A engine recusou as fotos');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new EngineUnavailableError(`Engine facial respondeu ${res.status}`);
    }
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new EngineUnavailableError('Resposta da engine fora do contrato');
    return parsed.data;
  }

  calibrateRecognition(input: { legitimate: readonly CalibrationImage[]; impostor: readonly CalibrationImage[] }): Promise<EngineRecognitionCalibration> {
    return this.postCalibration('/calibrate/recognition', { legitimate_images: input.legitimate, impostor_images: input.impostor }, engineRecognitionCalibrationSchema);
  }

  calibrateLiveness(input: { real: readonly CalibrationImage[]; attack: readonly CalibrationImage[] }): Promise<EngineLivenessCalibration> {
    return this.postCalibration('/calibrate/liveness', { real_images: input.real, attack_images: input.attack }, engineLivenessCalibrationSchema);
  }

  async registerEmbedding(input: RegisterEmbeddingInput): Promise<EngineRegisterResponse> {
    const form = new FormData();
    form.append('tenant_id', input.engineTenantId);
    form.append('person_id', String(input.personId));
    input.images.forEach((img, i) => form.append('files', new Blob([new Uint8Array(img.data)], { type: img.mime }), `foto-${i + 1}`));
    form.append('dek_ct', input.dek.ciphertextHex);
    form.append('dek_iv', input.dek.ivHex);
    form.append('dek_tag', input.dek.tagHex);
    form.append('dek_key_version', String(input.dek.keyVersion));

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.o.baseUrl.replace(/\/$/, '')}/embeddings/register`, {
        method: 'POST',
        headers: { 'X-API-Key': this.o.apiKey },
        body: form,
        signal: AbortSignal.timeout(this.o.timeoutMs ?? 30_000),
      });
    } catch {
      throw new EngineUnavailableError('Engine facial indisponível');
    }
    if (res.status === 400 || res.status === 422) {
      await res.body?.cancel();
      throw new EngineRejectedError('A engine recusou as fotos');
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new EngineUnavailableError(`Engine facial respondeu ${res.status}`);
    }
    const parsed = engineRegisterResponseSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success || parsed.data.person_id !== input.personId) {
      throw new EngineUnavailableError('Resposta da engine fora do contrato');
    }
    return parsed.data;
  }
}
