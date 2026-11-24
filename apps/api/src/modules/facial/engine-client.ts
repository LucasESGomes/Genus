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

export interface FacialEngineClient {
  registerEmbedding(input: RegisterEmbeddingInput): Promise<EngineRegisterResponse>;
}

export interface HttpFacialEngineOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpFacialEngineClient implements FacialEngineClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly o: HttpFacialEngineOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
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
