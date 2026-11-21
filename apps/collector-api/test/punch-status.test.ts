/**
 * GET /coletor/batidas/jobs/:jobId e GET /coletor/batidas?employeeId=.
 * Banco próprio (não limpa entre testes): o caso `processado` grava em
 * `registros` e `evidencias`, que só aceitam INSERT. Cada teste usa
 * sequências próprias.
 */
import { randomBytes } from 'node:crypto';
import { punchJobId } from '@genus/queue';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, ENGINE_API_KEY, MASTER_KEY, postPunch, SERVICE_KEY, type TestApp } from './support/harness';
import { startEngineStub, type EngineStub } from './support/engine-stub';

const DEVICE_ID = 100;
const TENANT_ID = 1;

let db: ArpTestDatabase;
let owner: pg.Pool;
let core: pg.Pool;
let stub: EngineStub;
let t: TestApp | undefined;

beforeAll(async () => {
  db = await startArpTestDatabase();
  owner = new pg.Pool({ connectionString: db.ownerUrl, max: 2 });
  core = new pg.Pool({ connectionString: db.coreUrl, max: 2 });
  stub = await startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY });
}, 120_000);

afterAll(async () => {
  await stub.close();
  await core.end();
  await owner.end();
  await db.stop();
});

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(env?: Record<string, string>): Promise<TestApp> {
  t = await createTestApp({ collectorUrl: db.collectorUrl, engineUrl: stub.url, env });
  return t;
}

function get(a: TestApp, url: string, serviceKey: string | null = SERVICE_KEY) {
  return a.app.inject({ method: 'GET', url, headers: serviceKey === null ? {} : { 'x-service-key': serviceKey } });
}

async function entryBySequence(seq: number) {
  const { rows } = await owner.query<{ id: string; colaborador_id: string; estabelecimento_id: string }>(
    'SELECT id, colaborador_id, estabelecimento_id FROM entradas WHERE aparelho_id = $1 AND sequencia_aparelho = $2',
    [DEVICE_ID, seq],
  );
  if (!rows[0]) throw new Error('entrada não encontrada');
  return { id: Number(rows[0].id), employeeId: Number(rows[0].colaborador_id), establishmentId: Number(rows[0].estabelecimento_id) };
}

/** Faz o que o rep-core faz numa transação: registro, evidência, 3 eventos e `processado`. */
async function markProcessed(seq: number, nsr: number) {
  const e = await entryBySequence(seq);
  const client = await core.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO registros (estabelecimento_id, nsr, conta_id, tipo, cpf, marcado_em, gravado_em, tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash)
       VALUES ($1, $2, $3, '7', '12345678909', now(), now(), '03', false, $4, $5, 1)`,
      [e.establishmentId, nsr, TENANT_ID, randomBytes(32), Buffer.alloc(32)],
    );
    await client.query(
      `INSERT INTO evidencias (estabelecimento_id, nsr, conta_id, entrada_id, aparelho_id, sequencia_aparelho, colaborador_id, metodo_identificacao)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'facial')`,
      [e.establishmentId, nsr, TENANT_ID, e.id, DEVICE_ID, seq, e.employeeId],
    );
    for (const evento of ['generate-receipt-pdf', 'recalculate-day', 'official-qr']) {
      await client.query(
        `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload) VALUES ($1, $2, $3, $4, '{}')`,
        [TENANT_ID, e.establishmentId, evento, `${e.establishmentId}-${nsr}`],
      );
    }
    await client.query(
      `UPDATE entradas SET status = 'processado', tentativas = 1, processado_em = now() WHERE id = $1`,
      [e.id],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

describe('POST /coletor/batidas devolve o jobId', () => {
  it('registered traz jobId = <aparelho>-<sequencia>, o mesmo no reenvio', async () => {
    const a = await start();
    const first = await postPunch(a, { deviceSequence: 1001 });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.jobId).toBe(punchJobId(DEVICE_ID, 1001));
    const replay = await postPunch(a, { deviceSequence: 1001 });
    expect(replay.json().data.jobId).toBe(first.json().data.jobId);
    expect(a.queue.published.at(-1)).toMatchObject({ deviceId: DEVICE_ID, deviceSequence: 1001 });
  });

  it('jobId sai mesmo quando a publicação falha (o resgate usa o mesmo id)', async () => {
    const a = await start();
    a.queue.publishError = new Error('Valkey fora');
    const res = await postPunch(a, { deviceSequence: 1002 });
    expect(res.json().data).toMatchObject({ outcome: 'registered', jobId: '100-1002' });
  });

  it('fallback_required não tem jobId', async () => {
    const a = await start();
    stub.setBehavior({ status: 'face_not_recognized' });
    const res = await postPunch(a, { deviceSequence: 1003 });
    stub.setBehavior({ status: 'identified' });
    expect(res.json().data.outcome).toBe('fallback_required');
    expect(res.json().data).not.toHaveProperty('jobId');
  });
});

describe('GET /coletor/batidas/jobs/:jobId', () => {
  it('pendente, com o estado do job na fila', async () => {
    const a = await start();
    const post = await postPunch(a, { deviceSequence: 2001 });
    const jobId = post.json().data.jobId as string;
    a.queue.jobs.set(jobId, { state: 'waiting', attemptsMade: 0 });

    const res = await get(a, `/coletor/batidas/jobs/${jobId}`);
    expect(res.statusCode).toBe(200);
    const { employeeId } = await entryBySequence(2001);
    expect(res.json()).toEqual({
      data: {
        jobId,
        receiptId: post.json().data.receiptId,
        employeeId,
        establishmentId: 10,
        deviceSequence: 2001,
        status: 'pendente',
        attempts: 0,
        nsr: null,
        markedAt: post.json().data.markedAt,
        receivedAt: expect.any(String),
        processedAt: null,
        warnings: [],
        queue: { state: 'waiting', attemptsMade: 0 },
      },
    });
    expect(res.body).not.toMatch(/cpf|\d{11}/);
  });

  it('processado traz NSR e processedAt', async () => {
    const a = await start();
    await postPunch(a, { deviceSequence: 2002 });
    await markProcessed(2002, 1);
    a.queue.jobs.set('100-2002', { state: 'completed', attemptsMade: 1 });

    const res = await get(a, '/coletor/batidas/jobs/100-2002');
    expect(res.json().data).toMatchObject({
      status: 'processado',
      attempts: 1,
      nsr: 1,
      processedAt: expect.any(String),
      queue: { state: 'completed', attemptsMade: 1 },
    });
  });

  it('job fora do Valkey: not_found; Valkey fora: unavailable (a consulta não cai)', async () => {
    const a = await start();
    await postPunch(a, { deviceSequence: 2003 });
    expect((await get(a, '/coletor/batidas/jobs/100-2003')).json().data.queue).toEqual({ state: 'not_found', attemptsMade: null });

    a.queue.getJobError = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:6379'), { code: 'ECONNREFUSED' });
    const res = await get(a, '/coletor/batidas/jobs/100-2003');
    expect(res.statusCode).toBe(200);
    expect(res.json().data.queue).toEqual({ state: 'unavailable', attemptsMade: null });
    expect(a.log.text()).toContain('queue_state_failed');
    expect(a.log.text()).not.toContain('10.0.0.1');
  });

  it('404 para jobId inexistente, malformado ou de outra conta', async () => {
    const a = await start();
    await postPunch(a, { deviceSequence: 2004 });
    for (const jobId of ['100-999999', 'abc', '100-0', '0-1', '100-2004-1']) {
      const res = await get(a, `/coletor/batidas/jobs/${jobId}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Batida não encontrada', code: 'NOT_FOUND' });
    }
    // Outra conta (mesmo aparelho e sequência, tenant diferente): não enxerga.
    const other = await createTestApp({ collectorUrl: db.collectorUrl, engineUrl: stub.url, env: { DEV_TENANT_ID: '2' } });
    try {
      expect((await get(other, '/coletor/batidas/jobs/100-2004')).statusCode).toBe(404);
    } finally {
      await other.close();
    }
  });

  it('exige a chave de serviço', async () => {
    const a = await start();
    expect((await get(a, '/coletor/batidas/jobs/100-1', null)).statusCode).toBe(401);
  });
});

describe('GET /coletor/batidas?employeeId=', () => {
  it('lista as batidas do colaborador, mais recente primeiro, paginada', async () => {
    const a = await start();
    const seqs = [3001, 3002, 3003];
    for (const [i, seq] of seqs.entries()) {
      a.clock.set(new Date(Date.UTC(2026, 10, 18, 13, i * 5)).toISOString());
      await postPunch(a, { deviceSequence: seq, capturedAt: new Date(Date.UTC(2026, 10, 18, 13, i * 5)).toISOString() });
    }
    const { employeeId } = await entryBySequence(3001);
    const { rows } = await owner.query<{ n: string }>(
      'SELECT count(*) AS n FROM entradas WHERE conta_id = $1 AND colaborador_id = $2',
      [TENANT_ID, employeeId],
    );
    const total = Number(rows[0]!.n);

    const page1 = await get(a, `/coletor/batidas?employeeId=${employeeId}&pageSize=2`);
    expect(page1.statusCode).toBe(200);
    const body = page1.json();
    expect(body.meta).toEqual({ page: 1, pageSize: 2, total });
    expect(body.data).toHaveLength(2);
    expect(body.data[0].deviceSequence).toBe(3003);
    expect(body.data[1].deviceSequence).toBe(3002);
    expect(body.data[0]).not.toHaveProperty('queue');
    expect(body.data.every((p: { employeeId: number }) => p.employeeId === employeeId)).toBe(true);
  });

  it('colaborador sem batidas: lista vazia', async () => {
    const a = await start();
    const res = await get(a, '/coletor/batidas?employeeId=987654');
    expect(res.json()).toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('400 sem employeeId ou com pageSize acima de 100', async () => {
    const a = await start();
    expect((await get(a, '/coletor/batidas')).statusCode).toBe(400);
    expect((await get(a, '/coletor/batidas?employeeId=x')).statusCode).toBe(400);
    expect((await get(a, '/coletor/batidas?employeeId=1&pageSize=101')).statusCode).toBe(400);
  });
});
