import { decryptDek } from '@genus/shared';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PunchRepository } from '../src/modules/punches/repository';
import {
  closedPortUrl,
  createTestApp,
  ENGINE_API_KEY,
  JPEG,
  MASTER_KEY,
  PNG,
  postPunch,
  SERVER_NOW,
  SERVICE_KEY,
  SERVICE_KEY_NEW,
  type TestApp,
} from './support/harness';
import { startEngineStub, type EngineStub } from './support/engine-stub';

let db: ArpTestDatabase;
let owner: pg.Pool;
let stub: EngineStub;
let t: TestApp | undefined;

beforeAll(async () => {
  db = await startArpTestDatabase();
  owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });
  stub = await startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY });
}, 120_000);

afterAll(async () => {
  await stub.close();
  await owner.end();
  await db.stop();
});

beforeEach(async () => {
  await owner.query('TRUNCATE entradas');
  stub.resetCalls();
  stub.setBehavior({ status: 'identified' });
  stub.setDelay(0);
  stub.setHealth('ok');
});

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(env?: Record<string, string>, engineUrl = stub.url): Promise<TestApp> {
  t = await createTestApp({ collectorUrl: db.collectorUrl, engineUrl, env });
  return t;
}

async function rows() {
  const { rows } = await owner.query('SELECT * FROM entradas ORDER BY id');
  return rows as Record<string, unknown>[];
}

const iso = (offsetMs: number) => new Date(new Date(SERVER_NOW).getTime() + offsetMs).toISOString();

describe('autenticação por chave de serviço', () => {
  it('sem chave e com chave errada: 401 idêntico', async () => {
    const a = await start();
    const semChave = await postPunch(a, {}, null);
    const errada = await postPunch(a, {}, 'chave-errada-0123456789abcdef0123456789');
    expect(semChave.statusCode).toBe(401);
    expect(errada.statusCode).toBe(401);
    expect(semChave.json()).toEqual({ error: 'Não autorizado', code: 'UNAUTHORIZED' });
    expect(errada.body).toBe(semChave.body);
    expect(await rows()).toHaveLength(0);
  });

  it('aceita a segunda chave da lista (rotação)', async () => {
    const a = await start();
    expect((await postPunch(a, {}, SERVICE_KEY_NEW)).statusCode).toBe(200);
  });

  it('/coletor/* inexistente: 404 NOT_FOUND com chave válida', async () => {
    const a = await start();
    const res = await a.app.inject({ method: 'GET', url: '/nada', headers: { 'x-service-key': SERVICE_KEY } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Recurso não encontrado', code: 'NOT_FOUND' });
  });
});

describe('validação', () => {
  it.each([
    ['mime fora da lista', { image: JPEG, mime: 'image/gif' }],
    ['mime certo, magic bytes errados', { image: Buffer.from('isto nao e uma imagem'), mime: 'image/jpeg' }],
    ['declara PNG mas é JPEG', { image: JPEG, mime: 'image/png' }],
    ['declara JPEG mas é PNG', { image: PNG, mime: 'image/jpeg' }],
  ])('%s: 400 INVALID_IMAGE', async (_name, form) => {
    const a = await start();
    const res = await postPunch(a, form);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_IMAGE' });
    expect(typeof res.json().error).toBe('string');
    expect(stub.calls.recognize).toBe(0);
  });

  it('PNG válido é aceito', async () => {
    const a = await start();
    expect((await postPunch(a, { image: PNG, mime: 'image/png' })).statusCode).toBe(200);
  });

  it('imagem acima do limite: 413 IMAGE_TOO_LARGE', async () => {
    const a = await start({ MAX_IMAGE_BYTES: '1024' });
    const big = Buffer.concat([JPEG, Buffer.alloc(4096)]);
    const res = await postPunch(a, { image: big });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    expect(await rows()).toHaveLength(0);
  });

  it('sem imagem: 400 VALIDATION_ERROR', async () => {
    const a = await start();
    const res = await postPunch(a, { image: null });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it.each(['0', '-1', 'abc', '1.5'])('deviceSequence "%s": 400 VALIDATION_ERROR com details', async (seq) => {
    const a = await start();
    const res = await postPunch(a, { deviceSequence: seq });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details[0].path).toBe('deviceSequence');
  });

  it.each(['ontem', '2026-11-18T12:00:00', '2026-11-18'])('capturedAt "%s": 400 VALIDATION_ERROR', async (value) => {
    const a = await start();
    const res = await postPunch(a, { capturedAt: value });
    expect(res.statusCode).toBe(400);
    expect(res.json().details[0].path).toBe('capturedAt');
  });

  it('requisição que não é multipart: 400 com {error, code}', async () => {
    const a = await start();
    const res = await a.app.inject({
      method: 'POST',
      url: '/coletor/batidas',
      payload: { deviceSequence: 1 },
      headers: { 'x-service-key': SERVICE_KEY },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('candidatos e identidade enviados no corpo são ignorados', async () => {
    const a = await start();
    const { payload, headers } = await (async () => {
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' }), 'f.jpg');
      form.append('deviceSequence', '1');
      form.append('capturedAt', SERVER_NOW);
      form.append('tenantId', '999');
      form.append('deviceId', '999');
      form.append('candidates', '[]');
      const r = new Response(form);
      return { payload: Buffer.from(await r.arrayBuffer()), headers: { 'content-type': r.headers.get('content-type') ?? '' } };
    })();
    const res = await a.app.inject({
      method: 'POST',
      url: '/coletor/batidas',
      payload,
      headers: { ...headers, 'x-service-key': SERVICE_KEY },
    });
    expect(res.statusCode).toBe(200);
    const [row] = await rows();
    expect(row?.conta_id).toBe('1');
    expect(row?.aparelho_id).toBe('100');
    expect(stub.calls.lastCandidateCount).toBe(20);
  });
});

describe('batida reconhecida', () => {
  it('200 registered e uma linha pendente com os campos certos', async () => {
    const a = await start();
    const set = await a.container.candidateProvider.getCandidates({ tenantId: 1, establishmentId: 10, deviceId: 100 });
    const person = set.candidates[0]!;

    const res = await postPunch(a, { deviceSequence: 7, capturedAt: iso(-5_000) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toMatchObject({ outcome: 'registered', markedAt: iso(-5_000), warnings: [] });
    expect(body.meta).toBeUndefined();
    expect(Object.keys(body.data).sort()).toEqual(['markedAt', 'outcome', 'receiptId', 'warnings']);

    const list = await rows();
    expect(list).toHaveLength(1);
    const row = list[0]!;
    expect(row).toMatchObject({
      id_publico: body.data.receiptId,
      conta_id: '1',
      estabelecimento_id: '10',
      aparelho_id: '100',
      sequencia_aparelho: '7',
      colaborador_id: String(person.employeeId),
      cpf: person.cpf,
      metodo_identificacao: 'facial',
      status: 'pendente',
      eh_hora_divergente: false,
      nota_reconhecimento: 0.91,
    });
    expect(row.nota_vivacidade).toBeCloseTo(0.97, 5);
    expect((row.marcado_em as Date).toISOString()).toBe(iso(-5_000));
    expect((row.recebido_em as Date).toISOString()).toBe(SERVER_NOW);
    // trace_id da engine = id_publico da entrada; tenant da engine = conta.
    expect(stub.calls.lastTraceId).toBe(body.data.receiptId);
    expect(stub.calls.lastTenantId).toBe('1');
  });

  it('reenvio da mesma (aparelho, sequência): mesmo recibo, sem nova linha, sem chamar a engine', async () => {
    const a = await start();
    const first = await postPunch(a, { deviceSequence: 3, capturedAt: iso(-1000) });
    expect(stub.calls.recognize).toBe(1);
    a.log.clear();
    const second = await postPunch(a, { deviceSequence: 3, capturedAt: iso(-500) });
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toEqual(first.json().data);
    expect(stub.calls.recognize).toBe(1);
    expect(await rows()).toHaveLength(1);
    const logged = a.log.records().find((r) => r.msg === 'punch_recognition');
    expect(logged).toMatchObject({ replayed: true, outcome: 'registered', receiptId: first.json().data.receiptId });
  });

  it('reenvio simultâneo (corrida): um único recibo e uma única linha', async () => {
    const a = await start();
    stub.setDelay(100);
    const results = await Promise.all([1, 2, 3].map(() => postPunch(a, { deviceSequence: 9 })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(new Set(results.map((r) => r.json().data.receiptId)).size).toBe(1);
    expect(await rows()).toHaveLength(1);
  });

  it('mesma pessoa duas vezes em 60 s: duas linhas, a segunda com possible_duplicate', async () => {
    const a = await start();
    const first = await postPunch(a, { deviceSequence: 1, capturedAt: iso(-20_000) });
    const second = await postPunch(a, { deviceSequence: 2, capturedAt: iso(-10_000) });
    expect(first.json().data.warnings).toEqual([]);
    expect(second.statusCode).toBe(200);
    expect(second.json().data).toMatchObject({ outcome: 'registered', warnings: ['possible_duplicate'] });
    expect(await rows()).toHaveLength(2);
  });

  it('mesma pessoa com mais de 60 s de diferença: sem sinalização', async () => {
    const a = await start();
    await postPunch(a, { deviceSequence: 1, capturedAt: iso(-29_000) });
    a.clock.advance(120_000);
    const later = await postPunch(a, { deviceSequence: 2, capturedAt: iso(120_000 - 1000) });
    expect(later.json().data.warnings).toEqual([]);
  });
});

describe('hora do aparelho', () => {
  it.each([
    ['2 min no passado', -120_000],
    ['1 min no futuro', 60_000],
    ['31 s no passado', -31_000],
  ])('%s: usa a hora do servidor e sinaliza clock_divergence', async (_name, offset) => {
    const a = await start();
    const res = await postPunch(a, { capturedAt: iso(offset) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'registered', markedAt: SERVER_NOW, warnings: ['clock_divergence'] });
    const [row] = await rows();
    expect(row?.eh_hora_divergente).toBe(true);
    expect((row?.marcado_em as Date).toISOString()).toBe(SERVER_NOW);

    // Replay devolve o mesmo recibo, ainda sinalizado.
    const again = await postPunch(a, { capturedAt: iso(offset) });
    expect(again.json().data).toEqual(res.json().data);
  });

  it.each([
    ['30 s no passado (limite)', -30_000],
    ['10 s no passado', -10_000],
    ['agora', 0],
  ])('%s: mantém capturedAt, sem sinalização', async (_name, offset) => {
    const a = await start();
    const res = await postPunch(a, { capturedAt: iso(offset) });
    expect(res.json().data).toMatchObject({ markedAt: iso(offset), warnings: [] });
    const [row] = await rows();
    expect(row?.eh_hora_divergente).toBe(false);
  });
});

describe('fallback (nunca bloqueia, nunca grava)', () => {
  it.each([
    ['face_not_recognized', 'not_recognized'],
    ['liveness_failed', 'liveness_failed'],
    ['no_face_detected', 'no_face'],
    ['multiple_faces_detected', 'multiple_faces'],
  ] as const)('%s -> 200 fallback_required/%s', async (status, reason) => {
    const a = await start();
    stub.setBehavior({ status });
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ outcome: 'fallback_required', reason, warnings: [] });
    expect(await rows()).toHaveLength(0);
  });

  it('engine fora do ar (porta fechada): 200 engine_unavailable', async () => {
    const a = await start(undefined, await closedPortUrl());
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'fallback_required', reason: 'engine_unavailable' });
    expect(await rows()).toHaveLength(0);
  });

  it('engine lenta (acima do timeout): 200 engine_unavailable', async () => {
    const a = await start({ ENGINE_TIMEOUT_MS: '300' });
    stub.setDelay(1500);
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'fallback_required', reason: 'engine_unavailable' });
    expect(await rows()).toHaveLength(0);
  });

  it('engine degraded: 200 engine_degraded', async () => {
    stub.setHealth('degraded');
    const a = await start();
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'fallback_required', reason: 'engine_degraded' });
    expect(stub.calls.recognize).toBe(0);
    expect(await rows()).toHaveLength(0);
  });

  it('engine 5xx: 200 engine_unavailable', async () => {
    const a = await start();
    stub.setBehavior({ httpStatus: 503 });
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reason).toBe('engine_unavailable');
  });

  it('mais candidatos que o teto: 200 too_many_candidates, engine não chamada', async () => {
    const a = await start({ FAKE_CANDIDATES_COUNT: '241' });
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.reason).toBe('too_many_candidates');
    expect(stub.calls.recognize).toBe(0);
  });
});

describe('erros que NÃO viram fallback', () => {
  it('engine 422 (InvalidTag): 500 INTERNAL_ERROR e log critical', async () => {
    const a = await start();
    stub.setBehavior({ httpStatus: 422 });
    const res = await postPunch(a);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Erro interno', code: 'INTERNAL_ERROR' });
    expect(await rows()).toHaveLength(0);
    const critical = a.log.records().filter((r) => r.severity === 'critical' && r.level === 'error');
    expect(critical.length).toBeGreaterThan(0);
  });

  it('engine fora do contrato (401, 400 de imagem): 200 fallback_required, nada gravado', async () => {
    const a = await start();
    for (const httpStatus of [401, 400] as const) {
      stub.setBehavior({ httpStatus });
      const res = await postPunch(a);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ outcome: 'fallback_required', reason: 'engine_unavailable' });
    }
    expect(await rows()).toHaveLength(0);
  });

  it('erro de banco: 500 INTERNAL_ERROR sem vazar SQL', async () => {
    const a = await start({ ARP_DATABASE_URL: db.collectorUrl.replace('/arp', '/inexistente') });
    const res = await postPunch(a);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Erro interno', code: 'INTERNAL_ERROR' });
  });
});

describe('medição', () => {
  it('Server-Timing presente; meta.timings só com EXPOSE_TIMINGS=true', async () => {
    const off = await start();
    const res = await postPunch(off);
    expect(res.headers['server-timing']).toMatch(/validate;dur=[\d.]+, candidates;dur=[\d.]+, engine;dur=[\d.]+, engine-processing;dur=[\d.]+, db;dur=[\d.]+, total;dur=[\d.]+/);
    expect(res.json().meta).toBeUndefined();
    await t?.close();

    const on = await start({ EXPOSE_TIMINGS: 'true' });
    const withMeta = await postPunch(on, { deviceSequence: 2 });
    const { timings } = withMeta.json().meta;
    expect(Object.keys(timings).sort()).toEqual(
      ['candidates', 'dbInsert', 'engineProcessing', 'engineRoundTrip', 'engineStages', 'total', 'validate'],
    );
    expect(timings.engineProcessing).toBe(49);
    expect(timings.engineStages.detection_ms).toBe(27.1);
  });

  it('Server-Timing também em fallback e em erro de validação, sem etapas que não ocorreram', async () => {
    const a = await start();
    stub.setBehavior({ status: 'no_face_detected' });
    const fb = await postPunch(a);
    expect(fb.headers['server-timing']).toMatch(/validate;dur=.*engine;dur=.*total;dur=/);
    expect(fb.headers['server-timing']).not.toMatch(/db;dur/);

    const bad = await postPunch(a, { deviceSequence: 0 });
    expect(bad.statusCode).toBe(400);
    expect(bad.headers['server-timing']).toMatch(/^validate;dur=[\d.]+, total;dur=[\d.]+$/);
  });
});

describe('log sem segredos nem dados pessoais', () => {
  it('registrada, fallback, 401 e 422: nada sensível no log e um punch_recognition por batida', async () => {
    const a = await start();
    const ctx = { tenantId: 1, establishmentId: 10, deviceId: 100 };
    const set = await a.container.candidateProvider.getCandidates(ctx);
    const dek = decryptDek(set.tenantDek, MASTER_KEY);

    await postPunch(a, { deviceSequence: 1 });
    stub.setBehavior({ status: 'face_not_recognized' });
    await postPunch(a, { deviceSequence: 2 });
    await postPunch(a, { deviceSequence: 3 }, 'chave-errada-0123456789abcdef0123456789');
    stub.setBehavior({ httpStatus: 422 });
    await postPunch(a, { deviceSequence: 4 });

    const text = a.log.text();
    expect(text.length).toBeGreaterThan(0);
    const forbidden: [string, string][] = [
      ['chave de serviço', SERVICE_KEY],
      ['chave de serviço nova', SERVICE_KEY_NEW],
      ['chave da engine', ENGINE_API_KEY],
      ['MASTER_KEY', MASTER_KEY],
      ['DEK', dek.toString('hex')],
      ['DEK cifrada', set.tenantDek.ciphertextHex],
      ['chave errada', 'chave-errada-0123456789abcdef0123456789'],
      ...set.candidates.map((c, i): [string, string] => [`CPF ${i}`, c.cpf]),
      ...set.candidates.map((c, i): [string, string] => [`embedding ${i}`, c.embedding.ciphertextHex]),
    ];
    for (const [name, value] of forbidden) {
      expect(text.includes(value), `log contém ${name}`).toBe(false);
    }

    const records = a.log.records().filter((r) => r.msg === 'punch_recognition');
    // 401 não chega ao service: registrada, fallback e 422 (outcome error).
    expect(records.map((r) => r.outcome)).toEqual(['registered', 'fallback_required', 'error']);
    for (const r of records) {
      expect(Object.keys(r.timingsMs as object).sort()).toEqual(
        ['candidates', 'dbInsert', 'engineProcessing', 'engineRoundTrip', 'engineStages', 'total', 'validate'],
      );
      expect(r).toHaveProperty('traceId');
      expect(r).toHaveProperty('candidateCount');
      expect(r).toHaveProperty('replayed');
      expect(r).toHaveProperty('warnings');
    }
    expect(records[1]).toMatchObject({ reason: 'not_recognized', receiptId: null, candidateCount: 20 });
    expect(a.log.records().some((r) => r.level === 'warn' && String(r.msg).startsWith('auth:'))).toBe(true);
  });
});

describe('isolamento de tenant no repositório', () => {
  it('entrada da conta 2 não é encontrada por consulta da conta 1 (e vice-versa)', async () => {
    const a = await start();
    const repo = new PunchRepository(a.container.pool);
    const base = {
      establishmentId: 1,
      deviceId: 500,
      deviceSequence: 1,
      employeeId: 1,
      cpf: '52998224725',
      markedAt: new Date(SERVER_NOW),
      receivedAt: new Date(SERVER_NOW),
      isClockDivergent: false,
      recognitionScore: 0.9,
      livenessScore: 0.9,
    };
    const inserted = await repo.insertIfAbsent(2, { ...base, publicId: '11111111-1111-4111-8111-111111111111' });
    expect(inserted).not.toBeNull();

    expect(await repo.findByPublicId(1, '11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(await repo.findByDeviceSequence(1, 500, 1)).toBeNull();
    expect(await repo.existsByCpfBetween(1, '52998224725', new Date(0), new Date(SERVER_NOW))).toBe(false);

    expect(await repo.findByPublicId(2, '11111111-1111-4111-8111-111111111111')).not.toBeNull();
    expect(await repo.findByDeviceSequence(2, 500, 1)).not.toBeNull();
    expect(await repo.existsByCpfBetween(2, '52998224725', new Date(0), new Date(SERVER_NOW))).toBe(true);
  });

  it('a duplicidade não cruza contas', async () => {
    // Conta 2 já tem o CPF do candidato 1; a batida da conta 1 não vira possible_duplicate.
    const a = await start();
    const set = await a.container.candidateProvider.getCandidates({ tenantId: 1, establishmentId: 10, deviceId: 100 });
    const repo = new PunchRepository(a.container.pool);
    await repo.insertIfAbsent(2, {
      publicId: '22222222-2222-4222-8222-222222222222',
      establishmentId: 1,
      deviceId: 501,
      deviceSequence: 1,
      employeeId: 1,
      cpf: set.candidates[0]!.cpf,
      markedAt: new Date(iso(-5000)),
      receivedAt: new Date(SERVER_NOW),
      isClockDivergent: false,
      recognitionScore: null,
      livenessScore: null,
    });
    const res = await postPunch(a, { capturedAt: iso(-1000) });
    expect(res.json().data.warnings).toEqual([]);
  });
});
