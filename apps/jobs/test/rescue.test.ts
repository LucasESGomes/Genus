/**
 * Resgate contra Postgres e Valkey reais (Testcontainers; exige Docker).
 * O resgate lê com `arp_reader`; as linhas de teste são semeadas com `arp_owner`.
 */
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import {
  createPostPunchQueue,
  createProducerConnection,
  createPunchesQueue,
  postPunchJobId,
  punchJobId,
  type PostPunchJobData,
  type PunchJobData,
} from '@genus/queue';
import { FixedClock } from '@genus/shared';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseOutboxKey, runRescueOnce, type RescueDeps } from '../src/rescue';
import {
  captureLogs,
  insertEntries,
  insertOutbox,
  resetQueues,
  resetTables,
  startValkey,
  waitFor,
  type TestValkey,
} from './support';

let db: ArpTestDatabase;
let valkey: TestValkey;
let owner: pg.Pool;
let reader: pg.Pool;
let connection: Redis;
let punches: Queue<PunchJobData>;
let postPunch: Queue<PostPunchJobData>;
let nextEstablishment = 700;

const OLD = '2026-11-20T12:00:00.000Z';
/** "Agora" do resgate: 10 min depois de OLD. */
const NOW = '2026-11-20T12:10:00.000Z';

beforeAll(async () => {
  [db, valkey] = await Promise.all([startArpTestDatabase(), startValkey()]);
  owner = new pg.Pool({ connectionString: db.ownerUrl, max: 3 });
  reader = new pg.Pool({ connectionString: db.readerUrl, max: 3 });
  connection = createProducerConnection({ url: valkey.url, password: undefined, publishTimeoutMs: 5000 });
  punches = createPunchesQueue(connection, { attempts: 1 });
  postPunch = createPostPunchQueue(connection, { attempts: 1 });
});

beforeEach(async () => {
  await resetTables(owner);
  await resetQueues(valkey.url);
});

afterAll(async () => {
  await Promise.all([punches?.close(), postPunch?.close()]);
  connection?.disconnect();
  await Promise.all([owner?.end(), reader?.end()]);
  await Promise.all([db?.stop(), valkey?.stop()]);
});

function fresh(): { establishmentId: number; deviceId: number } {
  nextEstablishment += 1;
  return { establishmentId: nextEstablishment, deviceId: nextEstablishment + 30_000 };
}

function makeDeps(now: string = NOW, overrides: Partial<RescueDeps> = {}) {
  const log = captureLogs();
  const deps: RescueDeps = {
    reader,
    clock: new FixedClock(now),
    logger: log.logger,
    punchesQueue: punches,
    postPunchQueue: postPunch,
    minAgeMs: 30_000,
    postPunchDepthWarn: 10_000,
    ...overrides,
  };
  return { deps, log };
}

async function stateOf(queue: Queue<PunchJobData> | Queue<PostPunchJobData>, jobId: string): Promise<string> {
  const job = await queue.getJob(jobId);
  return job ? await job.getState() : 'absent';
}

describe('runRescueOnce', () => {
  it('E1: não republica o que tem menos de 30 s', async () => {
    const { establishmentId, deviceId } = fresh();
    // recebido 10 s antes de "agora".
    await insertEntries(owner, { count: 1, establishmentId, deviceId, receivedAt: '2026-11-20T12:09:50.000Z' });
    await insertOutbox(owner, { establishmentId, nsr: 1, createdAt: '2026-11-20T12:09:50.000Z' });
    const { deps } = makeDeps();

    const result = await runRescueOnce(deps);

    expect(result).toMatchObject({ entradasReenfileiradas: 0, outboxReenfileirados: 0, ignorados: 0 });
    expect(await punches.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed')).toEqual({
      waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0,
    });
    expect((await postPunch.getJobCounts('waiting')).waiting).toBe(0);
  });

  it('E2: entrada pendente antiga e sem job vira job em punches com o jobId e o payload certos', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await insertEntries(owner, { count: 1, establishmentId, deviceId, receivedAt: OLD, firstSequence: 7 });
    const { deps, log } = makeDeps();

    const result = await runRescueOnce(deps);

    expect(result.entradasReenfileiradas).toBe(1);
    const job = await punches.getJob(punchJobId(deviceId, 7));
    expect(job).toBeDefined();
    expect(await job!.getState()).toBe('waiting');
    expect(job!.data).toEqual({ entryId: entry!.entryId, tenantId: 1, establishmentId });
    const round = log.byEvent('rescue_round');
    expect(round).toHaveLength(1);
    expect(round[0]).toMatchObject({ entradas_reenfileiradas: 1, outbox_reenfileirados: 0 });
    expect(JSON.stringify(log.lines)).not.toMatch(/12345678901|postgres:\/\//);

    // Repetir não duplica: o job já está na fila.
    const again = await runRescueOnce(deps);
    expect(again).toMatchObject({ entradasReenfileiradas: 0, ignorados: 1 });
    expect((await punches.getJobCounts('waiting')).waiting).toBe(1);
  });

  it('E2b: evento de outbox pendente e antigo vira job em post-punch (nome do job = evento)', async () => {
    const { establishmentId } = fresh();
    const ids = await insertOutbox(owner, { establishmentId, nsr: 5, createdAt: OLD });
    const { deps } = makeDeps();

    const result = await runRescueOnce(deps);

    expect(result.outboxReenfileirados).toBe(3);
    const job = await postPunch.getJob(postPunchJobId('recalculate-day', establishmentId, 5));
    expect(job?.name).toBe('recalculate-day');
    expect(job?.data).toMatchObject({ tenantId: 1, establishmentId, nsr: 5 });
    expect(ids).toContain(job!.data.outboxId);
    expect((await postPunch.getJobCounts('waiting')).waiting).toBe(3);
  });

  it('E3: job failed preso volta a waiting (retry)', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await insertEntries(owner, { count: 1, establishmentId, deviceId, receivedAt: OLD });
    const jobId = punchJobId(deviceId, 1);
    await punches.add('punch', { entryId: entry!.entryId, tenantId: 1, establishmentId }, { jobId });
    const failing = new Worker('punches', async () => {
      throw new Error('falha de teste');
    }, { connection: new Redis(valkey.url, { maxRetriesPerRequest: null }) });
    failing.on('error', () => undefined);
    await waitFor(async () => (await stateOf(punches, jobId)) === 'failed', 'job failed');
    await failing.close();

    const { deps } = makeDeps();
    const result = await runRescueOnce(deps);

    expect(result.entradasReenfileiradas).toBe(1);
    expect(await stateOf(punches, jobId)).toBe('waiting');
  });

  it('E4: job completed com a linha ainda pendente é removido e reenfileirado', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await insertEntries(owner, { count: 1, establishmentId, deviceId, receivedAt: OLD });
    const jobId = punchJobId(deviceId, 1);
    await punches.add('punch', { entryId: entry!.entryId, tenantId: 1, establishmentId }, { jobId });
    // Worker que "conclui" sem tocar no banco: a entrada segue pendente.
    const workerConn = new Redis(valkey.url, { maxRetriesPerRequest: null });
    const noop = new Worker('punches', async () => undefined, { connection: workerConn });
    noop.on('error', () => undefined);
    await waitFor(async () => (await stateOf(punches, jobId)) === 'completed', 'job completed');
    await noop.close();
    workerConn.disconnect();

    const { deps } = makeDeps();
    const result = await runRescueOnce(deps);

    expect(result.entradasReenfileiradas).toBe(1);
    const job = await punches.getJob(jobId);
    expect(await job!.getState()).toBe('waiting');
    expect(job!.finishedOn).toBeUndefined();
  });

  it('E5: evento já publicado e concluído, com a linha de outbox processada, não é republicado', async () => {
    const { establishmentId } = fresh();
    // nsr 1: linhas já processadas. nsr 2: ainda pendentes, mas com job completed (cai no remove + add).
    await insertOutbox(owner, { establishmentId, nsr: 1, createdAt: OLD, status: 'processado' });
    await insertOutbox(owner, { establishmentId, nsr: 2, createdAt: OLD });
    const processedIds = ['generate-receipt-pdf', 'recalculate-day', 'official-qr'].map((e) => postPunchJobId(e, establishmentId, 1));
    for (const jobId of processedIds) {
      await postPunch.add('recalculate-day', { outboxId: 1, tenantId: 1, establishmentId, nsr: 1 }, { jobId });
    }
    const workerConn = new Redis(valkey.url, { maxRetriesPerRequest: null });
    const consumer = new Worker('post-punch', async () => undefined, { connection: workerConn });
    consumer.on('error', () => undefined);
    await waitFor(async () => (await postPunch.getJobCounts('completed')).completed === 3, '3 jobs completed');
    await consumer.close();
    workerConn.disconnect();

    const { deps } = makeDeps();
    const result = await runRescueOnce(deps);

    // Só as 3 linhas pendentes do nsr 2 foram publicadas; o nsr 1 ficou como estava.
    expect(result.outboxReenfileirados).toBe(3);
    for (const jobId of processedIds) expect(await stateOf(postPunch, jobId)).toBe('completed');
    expect((await postPunch.getJobCounts('waiting')).waiting).toBe(3);
    expect(await stateOf(postPunch, postPunchJobId('official-qr', establishmentId, 2))).toBe('waiting');
  });

  it('E6: o resgate nunca escreve no banco (arp_reader recusa UPDATE com 42501)', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await insertEntries(owner, { count: 1, establishmentId, deviceId, receivedAt: OLD });
    await insertOutbox(owner, { establishmentId, nsr: 1, createdAt: OLD });
    const before = await owner.query('SELECT id, status, tentativas FROM entradas ORDER BY id');
    const outboxBefore = await owner.query('SELECT id, status, tentativas FROM outbox ORDER BY id');

    await expect(reader.query("UPDATE entradas SET status = 'falhou' WHERE id = $1", [entry!.entryId])).rejects.toMatchObject({ code: '42501' });
    await expect(reader.query("UPDATE outbox SET status = 'processado'")).rejects.toMatchObject({ code: '42501' });
    await expect(reader.query('DELETE FROM entradas')).rejects.toMatchObject({ code: '42501' });
    await expect(reader.query("INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload) VALUES (1, 1, 'official-qr', '1-1', '{}')")).rejects.toMatchObject({ code: '42501' });

    const { deps } = makeDeps();
    await runRescueOnce(deps);

    expect((await owner.query('SELECT id, status, tentativas FROM entradas ORDER BY id')).rows).toEqual(before.rows);
    expect((await owner.query('SELECT id, status, tentativas FROM outbox ORDER BY id')).rows).toEqual(outboxBefore.rows);
  });

  it('E7: 600 entradas antigas viram 600 jobs em dois lotes (500 + 100), sem duplicar', async () => {
    const { establishmentId, deviceId } = fresh();
    await insertEntries(owner, { count: 600, establishmentId, deviceId, receivedAt: OLD });
    const { deps, log } = makeDeps();

    const first = await runRescueOnce(deps);

    expect(first).toMatchObject({ entradasReenfileiradas: 600, lotes: 2, ignorados: 0 });
    expect((await punches.getJobCounts('waiting')).waiting).toBe(600);

    const second = await runRescueOnce(deps);
    expect(second).toMatchObject({ entradasReenfileiradas: 0, ignorados: 600 });
    expect((await punches.getJobCounts('waiting')).waiting).toBe(600);
    expect(log.byEvent('rescue_round')).toHaveLength(2);
  });

  it('avisa quando a profundidade de post-punch passa do limite', async () => {
    const { establishmentId } = fresh();
    await insertOutbox(owner, { establishmentId, nsr: 1, createdAt: OLD });
    const { deps, log } = makeDeps(NOW, { postPunchDepthWarn: 2 });

    await runRescueOnce(deps);

    const warn = log.byEvent('post_punch_depth_high');
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ level: 'warn', depth: 3, threshold: 2 });
  });

  it('ignora linha de outbox com chave inválida, sem derrubar a rodada', async () => {
    const { establishmentId } = fresh();
    await owner.query(
      `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload, criado_em)
       VALUES (1, $1, 'official-qr', 'lixo', '{}'::jsonb, $2::timestamptz)`,
      [establishmentId, OLD],
    );
    const { deps, log } = makeDeps();

    const result = await runRescueOnce(deps);

    expect(result).toMatchObject({ outboxReenfileirados: 0, ignorados: 1 });
    expect(log.byEvent('rescue_invalid_outbox')).toHaveLength(1);
  });
});

describe('parseOutboxKey', () => {
  it('lê <estabelecimento>-<nsr> e recusa o que não bate', () => {
    expect(parseOutboxKey('10-25', 10)).toBe(25);
    expect(parseOutboxKey('10-25', 11)).toBeNull();
    expect(parseOutboxKey('10-0', 10)).toBeNull();
    expect(parseOutboxKey('10-abc', 10)).toBeNull();
    expect(parseOutboxKey('10-25-3', 10)).toBeNull();
    expect(parseOutboxKey('', 10)).toBeNull();
  });
});
