/**
 * Worker da fila `punches` contra Postgres e Valkey reais (Testcontainers; exige Docker).
 * Cobre a ordem de sucesso da SPEC §2: o job só termina depois do COMMIT do NSR e a
 * publicação em `post-punch` é tolerante a falha.
 */
import { createProducerConnection } from '@genus/queue';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { createPostPunchPublisher, type PostPunchPublisher } from '../../src/worker/post-punch-publisher';
import { scalar, seedEntries } from '../support/arp-fixtures';
import {
  captureLogs,
  resetQueues,
  startHarness,
  startValkey,
  waitFor,
  type TestValkey,
  type WorkerHarness,
} from './support';

let db: ArpTestDatabase;
let valkey: TestValkey;
let core: pg.Pool;
let owner: pg.Pool;
let nextEstablishment = 500;
let harness: WorkerHarness | undefined;

beforeAll(async () => {
  [db, valkey] = await Promise.all([startArpTestDatabase(), startValkey()]);
  core = new pg.Pool({ connectionString: db.coreUrl, max: 12 });
  owner = new pg.Pool({ connectionString: db.ownerUrl, max: 3 });
});

afterEach(async () => {
  await harness?.close();
  harness = undefined;
  await resetQueues(valkey.url);
});

afterAll(async () => {
  await Promise.all([core?.end(), owner?.end()]);
  await Promise.all([db?.stop(), valkey?.stop()]);
});

function fresh(): { establishmentId: number; deviceId: number } {
  nextEstablishment += 1;
  return { establishmentId: nextEstablishment, deviceId: nextEstablishment + 20_000 };
}

const TENANT = 1;

async function seed(count: number, establishmentId: number, deviceId: number) {
  const ids = await seedEntries(db.collectorUrl, { tenantId: TENANT, establishmentId, deviceId, count });
  return ids.map((entryId, i) => ({ entryId, sequence: i + 1 }));
}

async function enqueueAll(
  h: WorkerHarness,
  entries: { entryId: number; sequence: number }[],
  establishmentId: number,
  deviceId: number,
) {
  for (const e of entries) {
    await h.enqueue({ entryId: e.entryId, tenantId: TENANT, establishmentId }, deviceId, e.sequence);
  }
}

async function jobCount(h: WorkerHarness, queue: 'punches' | 'postPunch', state: string): Promise<number> {
  const counts = await h[queue].getJobCounts(state as 'completed');
  return counts[state] ?? 0;
}

async function dbCounts(establishmentId: number) {
  return {
    registros: await scalar(owner, 'SELECT count(*) AS n FROM registros WHERE estabelecimento_id = $1', [establishmentId]),
    outbox: await scalar(owner, 'SELECT count(*) AS n FROM outbox WHERE estabelecimento_id = $1', [establishmentId]),
    outboxPendente: await scalar(
      owner,
      "SELECT count(*) AS n FROM outbox WHERE estabelecimento_id = $1 AND status = 'pendente'",
      [establishmentId],
    ),
    processadas: await scalar(
      owner,
      "SELECT count(*) AS n FROM entradas WHERE estabelecimento_id = $1 AND status = 'processado'",
      [establishmentId],
    ),
  };
}

/** Cria (como arp_owner) um trigger de teste em `outbox` e devolve a remoção. */
async function injectOutboxFailure(name: string, condition: string): Promise<() => Promise<void>> {
  await owner.query(`
    CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF ${condition} THEN
        RAISE EXCEPTION 'falha injetada no teste' USING ERRCODE = 'P0001';
      END IF;
      RETURN NEW;
    END; $$`);
  await owner.query(`CREATE TRIGGER ${name} BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  return async () => {
    await owner.query(`DROP TRIGGER IF EXISTS ${name} ON outbox`);
    await owner.query(`DROP FUNCTION IF EXISTS ${name}()`);
  };
}

describe('worker punches', () => {
  it('D1: fluxo feliz, 20 entradas viram NSR 1..20, 60 eventos de outbox e 60 jobs em post-punch', async () => {
    const { establishmentId, deviceId } = fresh();
    const entries = await seed(20, establishmentId, deviceId);
    harness = await startHarness({ valkeyUrl: valkey.url, pool: core });
    await enqueueAll(harness, entries, establishmentId, deviceId);

    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 20, '20 jobs completed');

    const nsrs = await owner.query<{ nsr: string }>(
      'SELECT nsr FROM registros WHERE estabelecimento_id = $1 ORDER BY nsr',
      [establishmentId],
    );
    expect(nsrs.rows.map((r) => Number(r.nsr))).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await dbCounts(establishmentId)).toMatchObject({ registros: 20, outbox: 60, processadas: 20 });
    expect(await jobCount(harness, 'postPunch', 'waiting')).toBe(60);
    expect(await jobCount(harness, 'punches', 'failed')).toBe(0);
    expect(harness.logs.byEvent('punch_processed')).toHaveLength(20);
    expect(harness.logs.byEvent('queue_publish_failed')).toHaveLength(0);
    // Nada de CPF em log.
    expect(JSON.stringify(harness.logs.lines)).not.toMatch(/\b\d{11}\b/);
  });

  it('D2: redelivery não duplica registro nem evento (jobId igual e entrada repetida em outro job)', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await seed(1, establishmentId, deviceId);
    harness = await startHarness({ valkeyUrl: valkey.url, pool: core });
    const payload = { entryId: entry!.entryId, tenantId: TENANT, establishmentId };

    // Mesmo jobId duas vezes: o BullMQ deduplica.
    await harness.enqueue(payload, deviceId, 1);
    await harness.enqueue(payload, deviceId, 1);
    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 1, 'primeiro job completed');
    expect((await harness.punches.getJobCounts('completed', 'waiting', 'active')).completed).toBe(1);

    // Redelivery depois de concluído: outro jobId apontando para a mesma entrada.
    await harness.punches.add('punch', payload, { jobId: 'redelivery-1' });
    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 2, 'redelivery completed');

    expect(await dbCounts(establishmentId)).toMatchObject({ registros: 1, outbox: 3, processadas: 1 });
    expect(await jobCount(harness, 'postPunch', 'waiting')).toBe(3);
    const outcomes = harness.logs.byEvent('punch_processed').map((l) => l.outcome);
    expect(outcomes).toEqual(['created', 'already_processed']);
  });

  it('D3: falha ao publicar em post-punch não falha o job; outbox fica pendente e há aviso', async () => {
    const { establishmentId, deviceId } = fresh();
    const entries = await seed(2, establishmentId, deviceId);
    const failing: PostPunchPublisher = {
      publish: () => Promise.reject(new Error('valkey indisponível')),
      close: async () => undefined,
    };
    harness = await startHarness({ valkeyUrl: valkey.url, pool: core, publisher: failing });
    await enqueueAll(harness, entries, establishmentId, deviceId);

    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 2, 'jobs completed');

    expect(await jobCount(harness, 'punches', 'failed')).toBe(0);
    expect(await dbCounts(establishmentId)).toMatchObject({ registros: 2, outbox: 6, outboxPendente: 6, processadas: 2 });
    expect(await jobCount(harness, 'postPunch', 'waiting')).toBe(0);
    const warns = harness.logs.byEvent('queue_publish_failed');
    expect(warns).toHaveLength(6);
    expect(warns.every((l) => l.level === 'warn')).toBe(true);
  });

  it('D3b: com o Valkey de post-punch inalcançável, o publicador real estoura o prazo sem falhar o job', async () => {
    const { establishmentId, deviceId } = fresh();
    const entries = await seed(1, establishmentId, deviceId);
    const { logger } = captureLogs();
    // Porta 1: ninguém escuta. Sem fila offline, a publicação falha rápido.
    const deadConn = createProducerConnection({ url: 'redis://127.0.0.1:1', password: undefined, publishTimeoutMs: 150 });
    deadConn.on('error', () => undefined);
    const dead = createPostPunchPublisher({ connection: deadConn, logger, timeoutMs: 150 });
    harness = await startHarness({ valkeyUrl: valkey.url, pool: core, publisher: dead });
    await enqueueAll(harness, entries, establishmentId, deviceId);

    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 1, 'job completed');
    expect(await dbCounts(establishmentId)).toMatchObject({ registros: 1, outboxPendente: 3 });
    expect(harness.logs.byEvent('queue_publish_failed')).toHaveLength(3);
    await dead.close();
    deadConn.disconnect();
  });

  it('D4: erro recuperável faz retry; 1 registro, 3 eventos e tentativas incrementada', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await seed(1, establishmentId, deviceId);
    // Falha enquanto existir entrada pendente deste estabelecimento com tentativas = 0:
    // só a primeira tentativa cai (o worker soma 1 antes de relançar).
    const remove = await injectOutboxFailure(
      'teste_falha_uma_vez',
      `EXISTS (SELECT 1 FROM entradas WHERE estabelecimento_id = NEW.estabelecimento_id AND status = 'pendente' AND tentativas = 0)`,
    );
    try {
      harness = await startHarness({ valkeyUrl: valkey.url, pool: core });
      const jobId = await harness.enqueue({ entryId: entry!.entryId, tenantId: TENANT, establishmentId }, deviceId, 1);

      await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 1, 'job completed após retry');

      const job = await harness.punches.getJob(jobId);
      // attemptsMade conta a falha e a tentativa que concluiu.
      expect(job?.attemptsMade).toBe(2);
      expect(await dbCounts(establishmentId)).toMatchObject({ registros: 1, outbox: 3, processadas: 1 });
      const row = await owner.query<{ tentativas: number; status: string }>(
        'SELECT tentativas, status FROM entradas WHERE id = $1',
        [entry!.entryId],
      );
      expect(row.rows[0]).toEqual({ tentativas: 1, status: 'processado' });
      expect(harness.logs.byEvent('punch_retry')).toHaveLength(1);
    } finally {
      await remove();
    }
  });

  it('D5: entrada inexistente falha na hora, sem retry, e não abre buraco de NSR', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await seed(1, establishmentId, deviceId);
    harness = await startHarness({ valkeyUrl: valkey.url, pool: core });

    const ghostId = await harness.enqueue({ entryId: 99_999_999, tenantId: TENANT, establishmentId }, deviceId + 1, 1);
    await waitFor(async () => (await jobCount(harness!, 'punches', 'failed')) === 1, 'job failed');
    const ghost = await harness.punches.getJob(ghostId);
    expect(ghost?.attemptsMade).toBe(1);
    expect(await dbCounts(establishmentId)).toMatchObject({ registros: 0, outbox: 0 });
    expect(harness.logs.byEvent('punch_unrecoverable')).toHaveLength(1);

    // O próximo registro real recebe o NSR 1: nada foi consumido.
    await harness.enqueue({ entryId: entry!.entryId, tenantId: TENANT, establishmentId }, deviceId, 1);
    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 1, 'job real completed');
    const nsr = await owner.query<{ nsr: string }>('SELECT nsr FROM registros WHERE estabelecimento_id = $1', [establishmentId]);
    expect(nsr.rows.map((r) => Number(r.nsr))).toEqual([1]);
  });

  it('D5b: payload inválido e entrada já marcada como falhou não repetem', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await seed(1, establishmentId, deviceId);
    await owner.query("UPDATE entradas SET status = 'falhou' WHERE id = $1", [entry!.entryId]);
    harness = await startHarness({ valkeyUrl: valkey.url, pool: core });

    const badId = 'payload-ruim-1';
    await harness.punches.add('punch', { entryId: 'abc' } as never, { jobId: badId });
    await harness.enqueue({ entryId: entry!.entryId, tenantId: TENANT, establishmentId }, deviceId, 1);

    await waitFor(async () => (await jobCount(harness!, 'punches', 'failed')) === 1, 'payload inválido failed');
    await waitFor(async () => (await jobCount(harness!, 'punches', 'completed')) === 1, 'entrada falhou ignorada');
    expect((await harness.punches.getJob(badId))?.attemptsMade).toBe(1);
    expect(harness.logs.byEvent('punch_payload_invalid')).toHaveLength(1);
    expect(harness.logs.byEvent('punch_entry_failed_skipped')).toHaveLength(1);
    expect(await dbCounts(establishmentId)).toMatchObject({ registros: 0 });
  });

  it('D6: tentativas esgotadas marcam a entrada como falhou, sem registro, e o job fica em failed', async () => {
    const { establishmentId, deviceId } = fresh();
    const [entry] = await seed(1, establishmentId, deviceId);
    const remove = await injectOutboxFailure('teste_falha_sempre', `NEW.estabelecimento_id = ${establishmentId}`);
    try {
      harness = await startHarness({ valkeyUrl: valkey.url, pool: core, attempts: 2 });
      const jobId = await harness.enqueue({ entryId: entry!.entryId, tenantId: TENANT, establishmentId }, deviceId, 1);

      await waitFor(async () => (await jobCount(harness!, 'punches', 'failed')) === 1, 'job failed após 2 tentativas');

      const job = await harness.punches.getJob(jobId);
      expect(job?.attemptsMade).toBe(2);
      const row = await owner.query<{ status: string; tentativas: number }>(
        'SELECT status, tentativas FROM entradas WHERE id = $1',
        [entry!.entryId],
      );
      expect(row.rows[0]).toEqual({ status: 'falhou', tentativas: 2 });
      expect(await dbCounts(establishmentId)).toMatchObject({ registros: 0, outbox: 0 });
      const alerts = harness.logs.byEvent('punch_failed_permanently');
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.level).toBe('error');
    } finally {
      await remove();
    }
  });
});
