import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createLogger,
  EngineIntegrityError,
  ENGINE_MAX_CANDIDATES,
  encryptDek,
  encryptEmbedding,
  generateDek,
  type Candidate,
  type RecognizeRequest,
} from '@genus/shared';
import { generateFakeCpf } from '../src/candidates/cpf';
import { randomUnitVector } from '../src/candidates/fake-candidate-provider';
import { HttpEngineClient } from '../src/engine/http-engine-client';
import { startEngineStub, type EngineStub } from './support/engine-stub';

const API_KEY = 'chave-da-engine-de-teste-0123456789';
const MASTER = randomBytes(32).toString('hex');
const dek = generateDek();
const tenantDek = encryptDek(dek, MASTER);

function makeCandidates(n: number, key = dek): Candidate[] {
  return Array.from({ length: n }, (_, i) => ({
    employeeId: i + 1,
    cpf: generateFakeCpf(i + 1),
    displayName: `Pessoa ${i + 1}`,
    embedding: encryptEmbedding(randomUnitVector(), key),
  }));
}

const candidates = makeCandidates(3);
let n = 0;
function request(over: Partial<RecognizeRequest> = {}): RecognizeRequest {
  return {
    tenantId: '1',
    image: Buffer.from('imagem-falsa'),
    imageMime: 'image/jpeg',
    candidates,
    tenantDek,
    traceId: `trace-${++n}`,
    ...over,
  };
}

const silent = createLogger({ level: 'silent', service: 'test' });
let stub: EngineStub;

function client(over: Partial<ConstructorParameters<typeof HttpEngineClient>[0]> = {}) {
  return new HttpEngineClient({
    baseUrl: stub.url, apiKey: API_KEY, timeoutMs: 2000, maxConcurrency: 4, logger: silent, ...over,
  });
}

beforeAll(async () => {
  stub = await startEngineStub({ apiKey: API_KEY, masterKeyHex: MASTER });
});
afterAll(async () => {
  await stub.close();
});
beforeEach(() => {
  stub.setBehavior({ status: 'identified' });
  stub.setDelay(0);
  stub.setHealth('ok');
  stub.resetCalls();
});

describe('HttpEngineClient', () => {
  it('identified devolve employeeId, scores e timing.stages', async () => {
    stub.setBehavior({ status: 'identified', personId: 2 });
    const r = await client().recognize(request());
    expect(r.kind).toBe('identified');
    if (r.kind !== 'identified') return;
    expect(r.employeeId).toBe(2);
    expect(r.recognitionScore).toBeCloseTo(0.91);
    expect(r.livenessScore).toBeCloseTo(0.97);
    expect(r.timing.processingMs).toBe(49);
    expect(r.timing.stages).toMatchObject({ detection_ms: expect.any(Number), total_ms: expect.any(Number) });
    expect(r.timing.roundTripMs).toBeGreaterThan(0);
    expect(r.timing.queueMs).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['face_not_recognized', 'not_recognized'],
    ['liveness_failed', 'liveness_failed'],
    ['no_face_detected', 'no_face'],
    ['multiple_faces_detected', 'multiple_faces'],
  ] as const)('status %s vira fallback/%s', async (status, reason) => {
    stub.setBehavior({ status });
    const r = await client().recognize(request());
    expect(r).toMatchObject({ kind: 'fallback', reason });
  });

  it('repassa trace_id, tenant_id e candidatos', async () => {
    const req = request({ traceId: 'trace-xyz' });
    await client().recognize(req);
    expect(stub.calls.lastTraceId).toBe('trace-xyz');
    expect(stub.calls.lastTenantId).toBe('1');
    expect(stub.calls.lastCandidateCount).toBe(3);
    expect(stub.calls.lastImageBytes).toBe(req.image.length);
  });

  it('candidatos acima do teto: fallback/too_many_candidates sem chamar a engine', async () => {
    const r = await client().recognize(request({ candidates: makeCandidates(ENGINE_MAX_CANDIDATES + 1) }));
    expect(r).toMatchObject({ kind: 'fallback', reason: 'too_many_candidates' });
    expect(stub.calls.recognize).toBe(0);
    expect(stub.calls.health).toBe(0);
  });

  it('aceita exatamente o teto de candidatos', async () => {
    const r = await client({ timeoutMs: 10_000 }).recognize(
      request({ candidates: makeCandidates(ENGINE_MAX_CANDIDATES) }),
    );
    expect(r.kind).toBe('identified');
    expect(stub.calls.lastCandidateCount).toBe(ENGINE_MAX_CANDIDATES);
  });

  it('timeout: fallback/engine_unavailable em ~timeoutMs', async () => {
    stub.setDelay(1500);
    const t0 = performance.now();
    const r = await client({ timeoutMs: 300 }).recognize(request());
    const elapsed = performance.now() - t0;
    expect(r).toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
    expect(elapsed).toBeGreaterThanOrEqual(280);
    expect(elapsed).toBeLessThan(900);
  });

  it.each([500, 503] as const)('HTTP %s vira fallback/engine_unavailable', async (httpStatus) => {
    stub.setBehavior({ httpStatus });
    expect(await client().recognize(request())).toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
  });

  it('porta fechada: fallback/engine_unavailable', async () => {
    const dead = await startEngineStub({ apiKey: API_KEY, masterKeyHex: MASTER });
    const url = dead.url;
    await dead.close();
    const r = await new HttpEngineClient({
      baseUrl: url, apiKey: API_KEY, timeoutMs: 1000, maxConcurrency: 2, logger: silent,
    }).recognize(request());
    expect(r).toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
    expect(await new HttpEngineClient({ baseUrl: url, apiKey: API_KEY, timeoutMs: 500, maxConcurrency: 1, logger: silent }).health()).toBe('down');
  });

  it('health degraded: fallback/engine_degraded sem chamar /recognize', async () => {
    stub.setHealth('degraded');
    const c = client();
    expect(await c.recognize(request())).toMatchObject({ kind: 'fallback', reason: 'engine_degraded' });
    expect(stub.calls.recognize).toBe(0);
    expect(await c.health()).toBe('degraded');
  });

  it('cacheia o estado de saúde por healthTtlMs', async () => {
    const c = client({ healthTtlMs: 60_000 });
    await c.recognize(request());
    await c.recognize(request());
    expect(stub.calls.health).toBe(1);
    expect(stub.calls.recognize).toBe(2);
    const fresh = client({ healthTtlMs: 0 });
    await fresh.recognize(request());
    await new Promise((r) => setTimeout(r, 5));
    await fresh.recognize(request());
    expect(stub.calls.health).toBe(3);
  });

  it('HTTP 422 lança EngineIntegrityError', async () => {
    stub.setBehavior({ httpStatus: 422 });
    await expect(client().recognize(request())).rejects.toBeInstanceOf(EngineIntegrityError);
  });

  it('embedding adulterado (rejeitado pelo stub com 422) lança EngineIntegrityError', async () => {
    const bad = makeCandidates(2);
    const first = bad[0]!;
    bad[0] = { ...first, embedding: { ...first.embedding, tagHex: (first.embedding.tagHex[0] === '0' ? '1' : '0') + first.embedding.tagHex.slice(1) } };
    await expect(client().recognize(request({ candidates: bad }))).rejects.toBeInstanceOf(EngineIntegrityError);
  });

  it('DEK que não decifra (MASTER_KEY diferente) lança EngineIntegrityError', async () => {
    const wrong = encryptDek(dek, randomBytes(32).toString('hex'));
    await expect(client().recognize(request({ tenantDek: wrong }))).rejects.toBeInstanceOf(EngineIntegrityError);
  });

  it('InvalidTag é logado como erro crítico e não vaza segredos', async () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'debug', service: 'test',
      destination: { write: (s: string) => { lines.push(s); } },
    });
    const c = client({ logger });
    await c.recognize(request());
    stub.setBehavior({ httpStatus: 422 });
    await expect(c.recognize(request())).rejects.toBeInstanceOf(EngineIntegrityError);
    const log = lines.join('');
    expect(log).toContain('"severity":"critical"');
    expect(log).toContain('"level":"error"');
    expect(log).not.toContain(API_KEY);
    expect(log).not.toContain(tenantDek.ciphertextHex);
    expect(log).not.toContain(tenantDek.tagHex);
    expect(log).not.toContain(dek.toString('hex'));
    for (const cand of candidates) {
      expect(log).not.toContain(cand.embedding.ciphertextHex.slice(0, 64));
      expect(log).not.toContain(cand.cpf);
    }
  });

  // Fora do contrato não bloqueia a marcação: vira fallback e log de erro.
  it('HTTP 401 (chave da engine errada) vira fallback/engine_unavailable', async () => {
    const result = await new HttpEngineClient({
      baseUrl: stub.url, apiKey: 'chave-errada', timeoutMs: 2000, maxConcurrency: 1, logger: silent,
    }).recognize(request());
    expect(result).toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
  });

  it('HTTP 400 genérico (ex.: imagem não decodificável) e JSON fora do schema viram fallback', async () => {
    stub.setBehavior({ httpStatus: 400 });
    await expect(client().recognize(request())).resolves.toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
    stub.setBehavior({ malformed: true });
    await expect(client().recognize(request())).resolves.toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
  });

  it('identificado fora da lista de candidatos vira fallback (nunca registra outra pessoa)', async () => {
    stub.setBehavior({ status: 'identified', personId: 999 });
    await expect(client().recognize(request())).resolves.toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
  });

  it('semáforo: nunca mais que maxConcurrency simultâneas na engine', async () => {
    stub.setDelay(120);
    const c = client({ maxConcurrency: 2, timeoutMs: 5000 });
    const results = await Promise.all(Array.from({ length: 5 }, () => c.recognize(request())));
    expect(results.every((r) => r.kind === 'identified')).toBe(true);
    expect(stub.calls.recognize).toBe(5);
    expect(stub.calls.maxConcurrent).toBe(2);
    expect(results.some((r) => r.timing.queueMs > 50)).toBe(true);
  });

  it('o prazo cobre a espera na fila: estourou, vira fallback e libera a vaga', async () => {
    stub.setDelay(400);
    const c = client({ maxConcurrency: 1, timeoutMs: 600 });
    const [a, b] = await Promise.all([c.recognize(request()), c.recognize(request())]);
    expect(a.kind).toBe('identified');
    expect(b).toMatchObject({ kind: 'fallback', reason: 'engine_unavailable' });
    stub.setDelay(0);
    expect((await c.recognize(request())).kind).toBe('identified');
  });
});
