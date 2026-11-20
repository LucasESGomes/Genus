/**
 * E7: job `failed` preso é recuperado pelo resgate (`retry()`); o resgate NÃO republica o que
 *     tem menos de 30 s (FixedClock na API e no resgate).
 * E8: evento de `post-punch` já publicado não duplica quando o resgate roda de novo.
 */
import { createWorkerConnection } from '@genus/queue';
import { FixedClock } from '@genus/shared';
import { Worker } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { countRegistros, entryStatusCounts, nsrList, outboxCounts } from '../support/asserts';
import { quiesce, resetQueues, startInfra, waitFor, type Infra } from '../support/infra';
import {
  disposer,
  openQueues,
  postPunch,
  rescueRunner,
  SERVER_NOW,
  startCollector,
  startRepCore,
  totalJobs,
} from '../support/stack';

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

const at = (offsetMs: number) => new FixedClock(new Date(Date.parse(SERVER_NOW) + offsetMs));

describe('E7: job failed preso é recuperado pelo resgate', () => {
  it('não mexe com menos de 30 s; depois de 30 s chama retry() e o worker processa', async () => {
    const est = 7801;
    const device = 8801;
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    // 1 tentativa: o primeiro erro do consumidor defeituoso já deixa o job em `failed`.
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device, attempts: 1 });
    cleanup.add(() => collector.close());

    // Consumidor defeituoso (ex.: versão antiga do rep-core que quebra) deixa o job em failed.
    const brokenConnection = createWorkerConnection({ url: infra.valkey.url, password: undefined });
    brokenConnection.on('error', () => undefined);
    const broken = new Worker(
      'punches',
      async () => {
        throw new Error('consumidor defeituoso (teste e2e)');
      },
      { connection: brokenConnection },
    );
    broken.on('error', () => undefined);

    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    await waitFor(async () => (await queues.punches.getJobCounts('failed'))['failed'] === 1, 'job em failed', 30_000);
    await broken.close();
    brokenConnection.disconnect();

    // A entrada segue pendente (o defeituoso nem tocou no banco).
    expect(await entryStatusCounts(infra.owner, est)).toEqual({ pendente: 1 });
    const rescue = rescueRunner(infra, queues);

    // < 30 s desde `recebido_em` (SERVER_NOW): não republica.
    const early = await rescue.run(at(29_000));
    expect(early.entradasReenfileiradas).toBe(0);
    expect(early.ignorados).toBe(0);
    expect(await queues.punches.getJobCounts('failed', 'waiting')).toEqual({ failed: 1, waiting: 0 });

    // > 30 s: retry() do job failed (mesmo jobId, nenhum job novo).
    const late = await rescue.run(at(31_000));
    expect(late.entradasReenfileiradas).toBe(1);
    expect(await queues.punches.getJobCounts('failed', 'waiting')).toEqual({ failed: 0, waiting: 1 });
    expect(await totalJobs(queues.punches)).toBe(1);

    const core = startRepCore(infra);
    cleanup.add(() => core.close());
    await waitFor(
      async () => (await entryStatusCounts(infra.owner, est))['processado'] === 1,
      'entrada processada após o retry do resgate',
      30_000,
    );
    expect(await nsrList(infra.owner, est)).toEqual([1]);
    expect(await outboxCounts(infra.owner, est)).toEqual({ pendente: 3 });
    expect(await totalJobs(queues.punches)).toBe(1);
  });
});

describe('E8: evento de post-punch já publicado não duplica', () => {
  async function processOnePunch(est: number, device: number) {
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device });
    cleanup.add(() => collector.close());
    const core = startRepCore(infra);
    cleanup.add(() => core.close());
    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    await waitFor(async () => (await totalJobs(queues.postPunch)) === 3, '3 jobs em post-punch', 30_000);
    await core.close();
    const dbNow = (await infra.owner.query<{ t: Date }>('SELECT now() AS t')).rows[0]!.t;
    return { queues, dbNow };
  }

  const waitingIds = async (q: Awaited<ReturnType<typeof openQueues>>) =>
    (await q.postPunch.getJobs(['waiting'])).map((j) => j.id).sort();

  it('jobs ainda na fila: dois resgates seguidos não criam job novo (mesmos jobIds)', async () => {
    const est = 7901;
    const { queues, dbNow } = await processOnePunch(est, 8901);
    const before = await waitingIds(queues);
    expect(before).toHaveLength(3);

    const rescue = rescueRunner(infra, queues);
    for (let round = 1; round <= 2; round++) {
      const res = await rescue.run(new FixedClock(new Date(dbNow.getTime() + 60_000 * round)));
      expect(res.outboxReenfileirados).toBe(0);
      expect(res.ignorados).toBe(3);
      expect(await totalJobs(queues.postPunch)).toBe(3);
      expect(await waitingIds(queues)).toEqual(before);
    }
    expect(await outboxCounts(infra.owner, est)).toEqual({ pendente: 3 });
  });

  it('job completed com a linha ainda pendente: o resgate recria com o MESMO jobId (SPEC §8), uma vez só', async () => {
    const est = 7902;
    const { queues, dbNow } = await processOnePunch(est, 8902);
    const before = await waitingIds(queues);

    // Consumidor de teste que conclui os jobs sem marcar o outbox (o consumidor real ainda não existe).
    const conn = createWorkerConnection({ url: infra.valkey.url, password: undefined });
    conn.on('error', () => undefined);
    const consumer = new Worker('post-punch', async () => undefined, { connection: conn });
    consumer.on('error', () => undefined);
    await waitFor(
      async () => (await queues.postPunch.getJobCounts('completed'))['completed'] === 3,
      '3 jobs concluídos pelo consumidor de teste',
      30_000,
    );
    await consumer.close();
    conn.disconnect();
    expect(await outboxCounts(infra.owner, est)).toEqual({ pendente: 3 });

    const rescue = rescueRunner(infra, queues);
    const first = await rescue.run(new FixedClock(new Date(dbNow.getTime() + 60_000)));
    expect(first.outboxReenfileirados).toBe(3);
    expect(await totalJobs(queues.postPunch)).toBe(3);
    expect(await queues.postPunch.getJobCounts('waiting', 'completed')).toEqual({ waiting: 3, completed: 0 });
    expect(await waitingIds(queues)).toEqual(before);

    // Segunda rodada: já estão `waiting`, não duplica.
    const second = await rescue.run(new FixedClock(new Date(dbNow.getTime() + 120_000)));
    expect(second.outboxReenfileirados).toBe(0);
    expect(await totalJobs(queues.postPunch)).toBe(3);
    expect(await countRegistros(infra.owner, est)).toBe(1);
  });
});
