/**
 * E5: falha permanente por entrada inexistente (ou de outra conta) -> job failed na hora,
 *     sem registro e sem buraco de NSR.
 * E6: job duplicado na fila gera 1 registro (mesmo jobId deduplica; outro jobId para a mesma
 *     entrada cai em `already_processed`).
 */
import { PUNCH_JOB_NAME, punchJobId } from '@genus/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chainReport,
  countEvidencias,
  countOutbox,
  countRegistros,
  entryIds,
  entryStatusCounts,
  nsrList,
} from '../support/asserts';
import { quiesce, resetQueues, startInfra, waitFor, type Infra } from '../support/infra';
import {
  disposer,
  enqueuePunch,
  openQueues,
  postPunch,
  startCollector,
  startRepCore,
  totalJobs,
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
  await resetQueues(infra.valkey.url);
  await quiesce(infra.owner);
});

describe('E5: falha permanente por entrada inexistente', () => {
  it('job failed sem retry, sem registro e sem buraco: a batida real seguinte é o NSR 1', async () => {
    const est = 7601;
    const device = 8601;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device });
    cleanup.add(() => collector.close());
    const core = startRepCore(infra, { attempts: 5 });
    cleanup.add(() => core.close());

    await enqueuePunch(queues, { entryId: 2_000_000_001, tenantId: TENANT, establishmentId: est }, 'fantasma-1');
    await waitFor(async () => (await queues.punches.getJobCounts('failed'))['failed'] === 1, 'job failed', 30_000);

    const failed = await queues.punches.getJob('fantasma-1');
    expect(failed?.attemptsMade).toBe(1); // não recuperável: sem nova tentativa, apesar de attempts = 5
    expect(failed?.failedReason).toBeTruthy();
    expect(core.logs.byEvent('punch_unrecoverable')).toHaveLength(1);
    expect(await countRegistros(infra.owner, est)).toBe(0);
    expect(await totalJobs(queues.postPunch)).toBe(0);

    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    await waitFor(async () => (await nsrList(infra.owner, est)).length === 1, 'registro real', 30_000);
    expect(await nsrList(infra.owner, est)).toEqual([1]);
    const { report, invariant } = await chainReport(infra, TENANT, est);
    expect(report.ok).toBe(true);
    expect(invariant).toEqual([]);
  });

  it('entrada de OUTRA conta (tenantId trocado no payload) não é processada e continua pendente', async () => {
    const est = 7602;
    const device = 8602;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device });
    cleanup.add(() => collector.close());
    // Sem worker ainda: a batida real fica na fila, e um job malicioso aponta para a mesma entrada com outra conta.
    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    const [entryId] = await entryIds(infra.owner, est);
    await queues.punches.obliterate({ force: true }); // tira o job legítimo; só o cruzado vai ao worker
    await enqueuePunch(queues, { entryId: entryId!, tenantId: 2, establishmentId: est }, 'conta-errada-1');

    const core = startRepCore(infra);
    cleanup.add(() => core.close());
    await waitFor(async () => (await queues.punches.getJobCounts('failed'))['failed'] === 1, 'job cruzado failed', 30_000);

    expect(await entryStatusCounts(infra.owner, est)).toEqual({ pendente: 1 });
    expect(await countRegistros(infra.owner, est)).toBe(0);
    expect(await countOutbox(infra.owner, est)).toBe(0);
    const [row] = (await infra.owner.query<{ tentativas: number }>(
      'SELECT tentativas FROM entradas WHERE id = $1',
      [entryId],
    )).rows;
    expect(row?.tentativas).toBe(0);
  });
});

describe('E6: job duplicado na fila gera 1 registro', () => {
  it('mesmo jobId deduplica; outro jobId para a mesma entrada vira already_processed; 1 registro e 3 eventos', async () => {
    const est = 7701;
    const device = 8701;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device });
    cleanup.add(() => collector.close());

    // Worker ainda desligado: os jobs se acumulam em `waiting`.
    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    expect(await queues.punches.getJobCounts('waiting')).toEqual({ waiting: 1 });
    const [entryId] = await entryIds(infra.owner, est);
    const data = { entryId: entryId!, tenantId: TENANT, establishmentId: est };

    // (1) mesmo jobId: o BullMQ deduplica.
    const jobId = punchJobId(device, 1);
    await queues.punches.add(PUNCH_JOB_NAME, data, { jobId });
    await queues.punches.add(PUNCH_JOB_NAME, data, { jobId });
    expect(await queues.punches.getJobCounts('waiting')).toEqual({ waiting: 1 });
    // (2) outro jobId, mesma entrada: entra de verdade na fila.
    await queues.punches.add(PUNCH_JOB_NAME, data, { jobId: 'duplicado-manual-1' });
    expect(await queues.punches.getJobCounts('waiting')).toEqual({ waiting: 2 });

    const core = startRepCore(infra, { concurrency: 4 });
    cleanup.add(() => core.close());
    await waitFor(
      async () => (await queues.punches.getJobCounts('completed'))['completed'] === 2,
      'os 2 jobs concluídos',
      30_000,
    );
    await waitFor(async () => (await totalJobs(queues.postPunch)) === 3, '3 jobs em post-punch', 15_000);

    expect(await nsrList(infra.owner, est)).toEqual([1]);
    expect(await countEvidencias(infra.owner, est)).toBe(1);
    expect(await countOutbox(infra.owner, est)).toBe(3);
    expect(await entryStatusCounts(infra.owner, est)).toEqual({ processado: 1 });
    // O segundo job republica os 3 eventos com o MESMO jobId: continua 1 job por evento.
    expect(await queues.postPunch.getJobCounts('waiting')).toEqual({ waiting: 3 });
    const outcomes = core.logs.byEvent('punch_processed').map((l) => l['outcome']).sort();
    expect(outcomes).toEqual(['already_processed', 'created']);
    expect(await queues.punches.getJobCounts('failed')).toEqual({ failed: 0 });
    const { report, invariant } = await chainReport(infra, TENANT, est);
    expect(report.ok).toBe(true);
    expect(invariant).toEqual([]);
  });
});
