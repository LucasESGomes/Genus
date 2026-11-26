/**
 * E2: ordem de sucesso (docs/SPEC-nsr-fila.md §2).
 *   E2a: o INSERT em `entradas` falha -> HTTP 5xx, nunca `registered`, nada na fila, nada em `registros`.
 *   E2b: falha no INSERT do outbox -> o job `punches` não termina com sucesso, a entrada segue
 *        `pendente`, `tentativas` sobe, nada em `post-punch`; ao remover a falha, 1 registro e 3 eventos.
 *   E2c: falha permanente (`falhou`) -> sem registro e sem buraco de NSR.
 */
import { createServer } from 'node:net';
import { punchJobId } from '@genus/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chainReport,
  countEntries,
  countEvidencias,
  countOutbox,
  countRegistros,
  nsrList,
  outboxCounts,
} from '../support/asserts';
import { quiesce, resetQueues, scalar, startInfra, waitFor, type Infra } from '../support/infra';
import {
  disposer,
  installOutboxFailure,
  openQueues,
  eventJobs,
  postPunch,
  removeOutboxFailure,
  startCollector,
  startRepCore,
  totalJobs,
  type Queues,
} from '../support/stack';

const TENANT = 1;
let infra: Infra;
let cleanup = disposer();

beforeAll(async () => {
  infra = await startInfra();
});

afterAll(async () => {
  await cleanup.run();
  await infra?.stop();
});

afterEach(async () => {
  await cleanup.run();
  cleanup = disposer();
  await removeOutboxFailure(infra.owner);
  await infra.owner.query('DROP TRIGGER IF EXISTS trg_e2e_falhar_entradas ON entradas');
  await infra.owner.query('DROP FUNCTION IF EXISTS e2e_falhar_entradas()');
  await resetQueues(infra.valkey.url);
  await quiesce(infra.owner);
});

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sem porta');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function entryRow(establishmentId: number) {
  const res = await infra.owner.query<{ status: string; tentativas: number }>(
    'SELECT status, tentativas FROM entradas WHERE estabelecimento_id = $1 ORDER BY id',
    [establishmentId],
  );
  return res.rows;
}

async function lastNsr(establishmentId: number): Promise<number> {
  return scalar(
    infra.owner,
    'SELECT COALESCE(max(ultimo_nsr), 0) AS n FROM sequencias_estabelecimento WHERE estabelecimento_id = $1',
    [establishmentId],
  );
}

describe('E2a: falha do INSERT em entradas nunca vira `registered`', () => {
  async function expectNothingHappened(est: number, queues: Queues, res: { statusCode: number; body: string }) {
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body['error']).toBe('string');
    expect(typeof body['code']).toBe('string');
    expect(body['data']).toBeUndefined();
    expect(res.body).not.toContain('registered');
    expect(await countEntries(infra.owner, est)).toBe(0);
    expect(await countRegistros(infra.owner, est)).toBe(0);
    expect(await countEvidencias(infra.owner, est)).toBe(0);
    expect(await countOutbox(infra.owner, est)).toBe(0);
    expect(await totalJobs(queues.punches)).toBe(0);
    expect(await eventJobs(queues)).toBe(0);
  }

  async function installEntriesTrigger(body: string): Promise<void> {
    await infra.owner.query(
      `CREATE OR REPLACE FUNCTION e2e_falhar_entradas() RETURNS trigger LANGUAGE plpgsql AS $fn$
       BEGIN ${body} RETURN NEW; END $fn$`,
    );
    await infra.owner.query(
      `CREATE TRIGGER trg_e2e_falhar_entradas BEFORE INSERT ON entradas
         FOR EACH ROW EXECUTE FUNCTION e2e_falhar_entradas()`,
    );
  }

  it('INSERT recusado pelo banco: 5xx { error, code }, nada publicado, nada em registros; depois da falha a mesma batida entra', async () => {
    const est = 7101;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: 8101 });
    cleanup.add(() => collector.close());
    await installEntriesTrigger(`RAISE EXCEPTION 'falha injetada no INSERT de entradas (teste e2e)';`);

    const res = await postPunch(collector, 1);
    await expectNothingHappened(est, queues, res);
    expect(collector.logs.byEvent('queue_publish_failed')).toHaveLength(0);

    // Sem a falha, a MESMA batida (mesmo aparelho e sequência) é aceita: nada ficou preso.
    await infra.owner.query('DROP TRIGGER trg_e2e_falhar_entradas ON entradas');
    const retry = await postPunch(collector, 1);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().data.outcome).toBe('registered');
    expect(await countEntries(infra.owner, est)).toBe(1);
    expect(await totalJobs(queues.punches)).toBe(1);
  });

  it('conexão do coletor derrubada no meio do INSERT (pg_terminate_backend dentro do trigger): 5xx, nada publicado', async () => {
    const est = 7102;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: 8102 });
    cleanup.add(() => collector.close());
    // O backend que executa o INSERT se mata e dorme para o sinal ser tratado antes do COMMIT.
    await installEntriesTrigger(`PERFORM pg_terminate_backend(pg_backend_pid()); PERFORM pg_sleep(2);`);

    const res = await postPunch(collector, 1);
    await expectNothingHappened(est, queues, res);
  });

  it('banco inalcançável (porta fechada): 5xx { error, code }, nada publicado', async () => {
    const est = 7103;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const port = await closedPort();
    const collector = await startCollector(infra, {
      establishmentId: est,
      deviceId: 8103,
      databaseUrl: `postgres://usuario:segredo@127.0.0.1:${port}/arp`,
    });
    cleanup.add(() => collector.close());

    const res = await postPunch(collector, 1);
    await expectNothingHappened(est, queues, res);
    // O erro devolvido ao aparelho não vaza host, porta nem credencial.
    expect(res.body).not.toContain(String(port));
    expect(res.body).not.toContain('segredo');
  });
});

describe('E2b: falha no outbox: o job não termina com sucesso e a entrada segue pendente', () => {
  it('retry automático: tentativas sobe, nada em post-punch, NSR não é consumido; sem a falha, 1 registro e 3 eventos', async () => {
    const est = 7201;
    const device = 8201;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    // 4 tentativas: espaço para observar o estado intermediário antes de esgotar.
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device, attempts: 4 });
    cleanup.add(() => collector.close());
    await installOutboxFailure(infra.owner);
    const core = startRepCore(infra, { attempts: 4, concurrency: 4 });
    cleanup.add(() => core.close());

    const res = await postPunch(collector, 1);
    expect(res.statusCode).toBe(200);

    await waitFor(async () => (await entryRow(est))[0]?.tentativas === 2, 'duas tentativas falhas em entradas', 30_000);

    // Estado intermediário: pendente, sem registro, sem evento, sem job em post-punch, NSR intocado.
    const [row] = await entryRow(est);
    expect(row).toEqual({ status: 'pendente', tentativas: expect.any(Number) });
    expect(row!.tentativas).toBeGreaterThanOrEqual(2);
    expect(await countRegistros(infra.owner, est)).toBe(0);
    expect(await countEvidencias(infra.owner, est)).toBe(0);
    expect(await countOutbox(infra.owner, est)).toBe(0);
    expect(await lastNsr(est)).toBe(0);
    expect(await eventJobs(queues)).toBe(0);
    const job = await queues.punches.getJob(punchJobId(device, 1));
    expect(job).toBeDefined();
    expect(await job!.getState()).not.toBe('completed');
    expect(core.logs.byEvent('punch_retry').length).toBeGreaterThanOrEqual(1);

    // Conserta a causa: a próxima tentativa do BullMQ conclui.
    await removeOutboxFailure(infra.owner);
    await waitFor(async () => (await entryRow(est))[0]?.status === 'processado', 'entrada processada após o conserto', 30_000);
    await waitFor(async () => (await eventJobs(queues)) === 3, '3 jobs de eventos', 15_000);

    expect(await nsrList(infra.owner, est)).toEqual([1]);
    expect(await countEvidencias(infra.owner, est)).toBe(1);
    expect(await outboxCounts(infra.owner, est)).toEqual({ pendente: 3 });
    // O job só conclui depois do COMMIT e da publicação dos eventos.
    await waitFor(
      async () => (await queues.punches.getJob(punchJobId(device, 1)))?.getState().then((s) => s === 'completed') ?? false,
      'job punches completed',
      15_000,
    );
    const { report, invariant } = await chainReport(infra, TENANT, est);
    expect(report.ok).toBe(true);
    expect(invariant).toEqual([]);
    expect(await queues.punches.getJobCounts('failed')).toEqual({ failed: 0 });
  });

  it('tentativas esgotadas (QUEUE_ATTEMPTS=1): job failed, entrada SEGUE pendente (política A), nada em registros nem em post-punch', async () => {
    const est = 7202;
    const device = 8202;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device, attempts: 1 });
    cleanup.add(() => collector.close());
    await installOutboxFailure(infra.owner);
    const core = startRepCore(infra, { attempts: 1 });
    cleanup.add(() => core.close());

    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    await waitFor(async () => (await queues.punches.getJobCounts('failed'))['failed'] === 1, 'job punches em failed', 30_000);

    expect(await entryRow(est)).toEqual([{ status: 'pendente', tentativas: 1 }]);
    expect(await countRegistros(infra.owner, est)).toBe(0);
    expect(await countOutbox(infra.owner, est)).toBe(0);
    expect(await lastNsr(est)).toBe(0);
    expect(await eventJobs(queues)).toBe(0);
    expect(core.logs.byEvent('punch_retry_exhausted')).toHaveLength(1);
    expect(core.logs.byEvent('punch_failed_permanently')).toHaveLength(0);
  });
});

describe('E2c: falha permanente não abre buraco de NSR', () => {
  it('erro não recuperável (sequência de outra conta) marca falhou, sem registro e sem consumir NSR; o retry não ressuscita a entrada', async () => {
    const est = 7301;
    const device = 8301;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device, attempts: 1 });
    cleanup.add(() => collector.close());
    // Erro PERMANENTE: a sequência do estabelecimento pertence a OUTRA conta (SequenceTenantMismatchError).
    await infra.owner.query(
      'INSERT INTO sequencias_estabelecimento (estabelecimento_id, conta_id, ultimo_nsr, ultimo_hash) VALUES ($1, 999, 0, NULL)',
      [est],
    );
    const core = startRepCore(infra, { attempts: 1 });
    cleanup.add(() => core.close());

    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    await waitFor(async () => (await entryRow(est))[0]?.status === 'falhou', 'entrada falhou', 30_000);
    expect(core.logs.byEvent('punch_unrecoverable')).toHaveLength(1);
    expect(core.logs.byEvent('punch_retry_exhausted')).toHaveLength(0);
    expect(await countRegistros(infra.owner, est)).toBe(0);
    expect(await lastNsr(est)).toBe(0);

    // O retry do job não ressuscita uma entrada falhou (terminal para o fluxo automático).
    const failedJob = await queues.punches.getJob(punchJobId(device, 1));
    await failedJob!.retry('failed', { resetAttemptsMade: true });
    await waitFor(async () => (await queues.punches.getJobCounts('completed'))['completed'] === 1, 'retry concluído', 30_000);
    expect(core.logs.byEvent('punch_entry_failed_skipped')).toHaveLength(1);
    expect(await countRegistros(infra.owner, est)).toBe(0);
    // Erro não recuperável não gasta tentativa: tentativas segue 0.
    expect(await entryRow(est)).toEqual([{ status: 'falhou', tentativas: 0 }]);
    expect(await lastNsr(est)).toBe(0);
  });
});
