/**
 * Stub HTTP do face-engine que respeita o contrato REAL (conferido em
 * services/face-engine): X-API-Key, campos multipart, DEK decifrada com a
 * MASTER_KEY (falha -> 400 "Erro ao descriptografar DEK"), embeddings decifrados
 * com a DEK (falha -> 422 InvalidTag). Reutilizável pelos testes da rota.
 */
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import {
  decryptDek,
  decryptEmbedding,
  encryptEmbedding,
  EMBEDDING_BYTES,
  type EncryptedDek,
  type EngineWireCandidate,
} from '@genus/shared';
import { randomUnitVector } from '../../src/candidates/fake-candidate-provider';

export type StubBehavior =
  | { status: 'identified'; personId?: number }
  | { status: 'face_not_recognized' | 'liveness_failed' | 'no_face_detected' | 'multiple_faces_detected' }
  | { httpStatus: 400 | 401 | 403 | 422 | 500 | 502 | 503 }
  /** 200 com JSON fora do schema. */
  | { malformed: true };

export interface StubCalls {
  recognize: number;
  health: number;
  register: number;
  /** Máximo de /recognize simultâneos observado. */
  maxConcurrent: number;
  lastTraceId: string | null;
  lastTenantId: string | null;
  lastCandidateCount: number | null;
  lastImageBytes: number | null;
  /** Campos de texto do último /recognize (inclui recognition_threshold e liveness_threshold, se enviados). */
  lastFields: Record<string, string> | null;
}

export interface EngineStub {
  url: string;
  calls: StubCalls;
  setBehavior(b: StubBehavior): void;
  /** Atraso (ms) aplicado só a /recognize, depois de validar a requisição. */
  setDelay(ms: number): void;
  setHealth(state: 'ok' | 'degraded'): void;
  resetCalls(): void;
  close(): Promise<void>;
}

const HEX = /^(?:[0-9a-fA-F]{2})*$/;

function emptyCalls(): StubCalls {
  return { recognize: 0, health: 0, register: 0, maxConcurrent: 0, lastTraceId: null, lastTenantId: null, lastCandidateCount: null, lastImageBytes: null, lastFields: null };
}

export interface EngineStubOptions {
  apiKey: string;
  masterKeyHex: string;
  /**
   * Expõe `POST /__control/behavior` (corpo = StubBehavior), `POST /__control/health`
   * (`{ state }`) e `POST /__control/delay` (`{ ms }`). Só para o runner do Postman:
   * a engine real não tem esses endpoints.
   */
  exposeControl?: boolean;
}

export async function startEngineStub(opts: EngineStubOptions): Promise<EngineStub> {
  const app = Fastify({ logger: false, forceCloseConnections: true });
  await app.register(multipart, { limits: { fieldSize: 16 * 1024 * 1024, fileSize: 16 * 1024 * 1024 } });

  let behavior: StubBehavior = { status: 'identified' };
  let delayMs = 0;
  let healthState: 'ok' | 'degraded' = 'ok';
  const calls = emptyCalls();
  let concurrent = 0;

  if (opts.exposeControl) {
    app.post('/__control/behavior', async (req) => {
      behavior = req.body as StubBehavior;
      return { ok: true };
    });
    app.post('/__control/health', async (req) => {
      const state = (req.body as { state?: string } | null)?.state;
      healthState = state === 'degraded' ? 'degraded' : 'ok';
      return { ok: true };
    });
    app.post('/__control/delay', async (req) => {
      delayMs = Number((req.body as { ms?: number } | null)?.ms ?? 0);
      return { ok: true };
    });
  }

  app.get('/health', async () => {
    calls.health++;
    return {
      status: healthState,
      models: {
        detector: true,
        embedder: true,
        liveness_v1: healthState === 'ok',
        liveness_v2: healthState === 'ok',
        calibration: true,
        calibration_recognition: true,
      },
    };
  });

  async function readForm(req: import('fastify').FastifyRequest) {
    const fields: Record<string, string> = {};
    const files: Buffer[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') files.push(await part.toBuffer());
      else fields[part.fieldname] = String(part.value);
    }
    return { fields, files };
  }

  function unauthorized(req: import('fastify').FastifyRequest): boolean {
    return req.headers['x-api-key'] !== opts.apiKey;
  }

  function readDek(fields: Record<string, string>): { dek: Buffer } | { error: string } {
    const { dek_ct, dek_iv, dek_tag } = fields;
    if (!dek_ct || !dek_iv || !dek_tag) return { error: 'DEK do tenant não fornecida e nenhuma DEK em cache para este tenant' };
    const enc: EncryptedDek = {
      ciphertextHex: dek_ct,
      ivHex: dek_iv,
      tagHex: dek_tag,
      keyVersion: Number(fields.dek_key_version ?? '1'),
    };
    try {
      return { dek: decryptDek(enc, opts.masterKeyHex) };
    } catch (e) {
      return { error: `Erro ao descriptografar DEK: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  app.post('/recognize', async (req, reply) => {
    if (unauthorized(req)) return reply.code(401).send({ detail: 'unauthorized' });
    const { fields, files } = await readForm(req);
    for (const name of ['tenant_id', 'candidates']) {
      if (!fields[name]) return reply.code(422).send({ detail: `campo ${name} ausente` });
    }
    if (files.length !== 1) return reply.code(422).send({ detail: 'campo image ausente' });

    const dekResult = readDek(fields);
    if ('error' in dekResult) return reply.code(400).send({ detail: dekResult.error });

    let list: EngineWireCandidate[];
    try {
      list = JSON.parse(fields.candidates as string) as EngineWireCandidate[];
      if (!Array.isArray(list)) throw new Error();
    } catch {
      return reply.code(400).send({ detail: 'candidates deve ser JSON válido' });
    }
    for (const c of list) {
      const ok =
        c.person_id !== undefined &&
        HEX.test(c.embedding_iv) && c.embedding_iv.length === 24 &&
        HEX.test(c.embedding_tag) && c.embedding_tag.length === 32 &&
        HEX.test(c.embedding_ct) && c.embedding_ct.length === EMBEDDING_BYTES * 2;
      if (!ok) return reply.code(422).send({ detail: 'Erro ao descriptografar embedding' });
      try {
        decryptEmbedding(
          { ivHex: c.embedding_iv, tagHex: c.embedding_tag, ciphertextHex: c.embedding_ct, keyVersion: c.key_version },
          dekResult.dek,
        );
      } catch {
        return reply.code(422).send({ detail: 'Embedding corrompido ou adulterado (InvalidTag)' });
      }
    }

    calls.recognize++;
    calls.lastTraceId = fields.trace_id ?? null;
    calls.lastTenantId = fields.tenant_id ?? null;
    calls.lastCandidateCount = list.length;
    calls.lastImageBytes = files[0]?.length ?? null;
    calls.lastFields = fields;

    concurrent++;
    calls.maxConcurrent = Math.max(calls.maxConcurrent, concurrent);
    try {
      if (delayMs > 0) {
        // Se o cliente abortar (timeout), a espera termina e a vaga deixa de contar.
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delayMs);
          reply.raw.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    } finally {
      concurrent--;
    }

    const b = behavior;
    if ('httpStatus' in b) {
      const detail = b.httpStatus === 401 ? 'unauthorized'
        : b.httpStatus === 422 ? 'Embedding corrompido ou adulterado (InvalidTag)'
        : b.httpStatus === 400 ? 'Imagem inválida ou não decodificável'
        : 'erro simulado';
      return reply.code(b.httpStatus).send({ detail });
    }
    if ('malformed' in b) return { unexpected: true };

    const timings = {
      dek_ms: 0.05, thresholds_ms: 0.01, candidates_parse_ms: 0.4, image_decode_ms: 4.2,
      detection_ms: 27.1, liveness_ms: 11.3, hsv_ms: 0.6, embedding_ms: 3.8,
      candidates_cache_lookup_ms: 0.1, candidates_decrypt_ms: 1.2, comparison_ms: 0.3,
      candidates_cache_hits: 0, candidates_cache_misses: list.length, total_ms: 49.1,
    };
    if (b.status === 'identified') {
      const first = list[0];
      const personId = b.personId ?? first?.person_id;
      return {
        status: 'identified', person_id: personId, confidence: 0.91, liveness_combined_raw: 0.97,
        best_distance_raw: 0.3, processing_ms: 49, timings_ms: timings,
      };
    }
    return {
      status: b.status, processing_ms: 31, timings_ms: timings,
      liveness_combined_raw: b.status === 'liveness_failed' ? 0.12 : null,
    };
  });

  app.post('/embeddings/register', async (req, reply) => {
    if (unauthorized(req)) return reply.code(401).send({ detail: 'unauthorized' });
    const { fields, files } = await readForm(req);
    calls.register++;
    if (!fields.tenant_id || !/^\d+$/.test(fields.person_id ?? '')) {
      return reply.code(422).send({ detail: 'tenant_id e person_id (inteiro) são obrigatórios' });
    }
    if (files.length < 1) return reply.code(400).send({ detail: 'Pelo menos 1 imagem é necessária' });
    if (files.length > 5) return reply.code(400).send({ detail: 'Máximo de 5 imagens permitidas' });
    const dekResult = readDek(fields);
    if ('error' in dekResult) return reply.code(400).send({ detail: dekResult.error });
    const enc = encryptEmbedding(randomUnitVector(), dekResult.dek);
    return {
      person_id: Number(fields.person_id),
      embedding_iv: enc.ivHex,
      embedding_tag: enc.tagHex,
      embedding_ct: enc.ciphertextHex,
      model_version: 'stub',
      images_processed: files.length,
    };
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('stub sem porta');

  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    setBehavior: (b) => { behavior = b; },
    setDelay: (ms) => { delayMs = ms; },
    setHealth: (s) => { healthState = s; },
    resetCalls: () => { Object.assign(calls, emptyCalls()); },
    close: () => app.close(),
  };
}
