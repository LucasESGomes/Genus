/**
 * E3: Valkey fora na hora da batida -> a API responde `registered`, a entrada fica `pendente`,
 *     e o resgate (apps/jobs) publica quando o Valkey volta; o worker processa.
 * E4: Valkey fora só na publicação de `post-punch` (depois do COMMIT) -> o job `punches`
 *     conclui, o outbox fica `pendente` (3 linhas) e o resgate publica depois.
 *
 * "Valkey fora" é um proxy TCP (ToggleProxy) entre o cliente em teste e o container: a porta
 * recusa conexão e derruba as abertas, igual a um Valkey parado, mas só para esse cliente e
 * sem trocar a porta mapeada do container que os outros clientes usam.
 */
import { FixedClock } from '@genus/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chainReport,
  countEvidencias,
  countOutbox,
  countRegistros,
  entryStatusCounts,
  nsrList,
  outboxCounts,
} from '../support/asserts';
import { quiesce, resetQueues, startInfra, ToggleProxy, waitFor, type Infra } from '../support/infra';
import {
  disposer,
  openQueues,
  eventJobs,
  postPunch,
  rescueRunner,
  SERVER_NOW,
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

async function newProxy(initiallyUp: boolean): Promise<ToggleProxy> {
  const proxy = await ToggleProxy.create({ host: infra.valkey.host, port: infra.valkey.port }, initiallyUp);
  cleanup.add(() => proxy.down());
  return proxy;
}

describe('E3: Valkey fora na hora da batida', () => {
  it('API responde registered com a entrada pendente; o resgate publica quando o Valkey volta e o worker processa', async () => {
    const est = 7401;
    const device = 8401;
    const proxy = await newProxy(false);
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device, valkeyUrl: proxy.url });
    cleanup.add(() => collector.close());

    const res = await postPunch(collector, 1);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome).toBe('registered');

    // A batida está gravada; a fila não recebeu nada.
    expect(await entryStatusCounts(infra.owner, est)).toEqual({ pendente: 1 });
    expect(await totalJobs(queues.punches)).toBe(0);
    const warns = collector.logs.byEvent('queue_publish_failed');
    expect(warns).toHaveLength(1);
    expect(warns[0]?.level).toBe('warn');
    expect(JSON.stringify(warns[0])).not.toContain(String(proxy.port));

    // Valkey volta (proxy ligado). O resgate só olha entradas pendentes há mais de 30 s.
    await proxy.up();
    const rescue = rescueRunner(infra, queues);
    const tooEarly = await rescue.run(new FixedClock(new Date(Date.parse(SERVER_NOW) + 10_000)));
    expect(tooEarly.entradasReenfileiradas).toBe(0);
    expect(await totalJobs(queues.punches)).toBe(0);

    const round = await rescue.run(new FixedClock(new Date(Date.parse(SERVER_NOW) + 60_000)));
    expect(round.entradasReenfileiradas).toBe(1);
    expect(round.outboxReenfileirados).toBe(0);
    expect(await queues.punches.getJobCounts('waiting')).toEqual({ waiting: 1 });

    const core = startRepCore(infra);
    cleanup.add(() => core.close());
    await waitFor(
      async () => (await entryStatusCounts(infra.owner, est))['processado'] === 1,
      'entrada processada após o resgate',
      30_000,
    );
    await waitFor(async () => (await eventJobs(queues)) === 3, '3 jobs de eventos', 15_000);

    expect(await nsrList(infra.owner, est)).toEqual([1]);
    expect(await countEvidencias(infra.owner, est)).toBe(1);
    expect(await countOutbox(infra.owner, est)).toBe(3);
    const { report, invariant } = await chainReport(infra, TENANT, est);
    expect(report.ok).toBe(true);
    expect(invariant).toEqual([]);

    // Resgate de novo: nada a fazer (a entrada já está processada).
    const again = await rescue.run(new FixedClock(new Date(Date.parse(SERVER_NOW) + 120_000)));
    expect(again.entradasReenfileiradas).toBe(0);
  });
});

describe('E4: Valkey fora só na publicação de post-punch (depois do COMMIT)', () => {
  it('o job punches conclui, o outbox fica pendente e o resgate publica os 3 eventos depois', async () => {
    const est = 7501;
    const device = 8501;
    const proxy = await newProxy(false);
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: est, deviceId: device });
    cleanup.add(() => collector.close());
    // Só o publicador de post-punch do worker passa pelo proxy (fora do ar).
    const core = startRepCore(infra, { postPunchUrl: proxy.url });
    cleanup.add(() => core.close());

    expect((await postPunch(collector, 1)).statusCode).toBe(200);
    await waitFor(
      async () => (await queues.punches.getJobCounts('completed'))['completed'] === 1,
      'job punches concluído',
      30_000,
    );

    // O COMMIT aconteceu e o job NÃO falhou, mas nada chegou a post-punch.
    expect(await entryStatusCounts(infra.owner, est)).toEqual({ processado: 1 });
    expect(await nsrList(infra.owner, est)).toEqual([1]);
    expect(await outboxCounts(infra.owner, est)).toEqual({ pendente: 3 });
    expect(await eventJobs(queues)).toBe(0);
    expect(await queues.punches.getJobCounts('failed')).toEqual({ failed: 0 });
    const warns = core.logs.byEvent('queue_publish_failed');
    expect(warns).toHaveLength(3);
    expect(new Set(warns.map((w) => w['queue']))).toEqual(new Set(['post-punch', 'day-recalculation']));
    expect(new Set(warns.map((w) => w['outboxEvent']))).toEqual(
      new Set(['generate-receipt-pdf', 'recalculate-day', 'official-qr']),
    );
    const processed = core.logs.byEvent('punch_processed');
    expect(processed).toHaveLength(1);
    expect(processed[0]?.['publishFailures']).toBe(3);

    // Valkey volta. O outbox.criado_em é a hora do BANCO (now()), não a do Clock injetado:
    // o relógio do resgate parte da hora do banco.
    await proxy.up();
    const dbNow = (await infra.owner.query<{ t: Date }>('SELECT now() AS t')).rows[0]!.t;
    const rescue = rescueRunner(infra, queues);

    const tooEarly = await rescue.run(new FixedClock(new Date(dbNow.getTime() + 5_000)));
    expect(tooEarly.outboxReenfileirados).toBe(0);
    expect(await eventJobs(queues)).toBe(0);

    const round = await rescue.run(new FixedClock(new Date(dbNow.getTime() + 60_000)));
    expect(round.outboxReenfileirados).toBe(3);
    expect(round.entradasReenfileiradas).toBe(0);
    expect(await queues.postPunch.getJobCounts('waiting')).toEqual({ waiting: 2 });
    expect(await queues.dayRecalculation.getJobCounts('waiting')).toEqual({ waiting: 1 });
    const jobIds = [
      ...(await queues.postPunch.getJobs(['waiting'])),
      ...(await queues.dayRecalculation.getJobs(['waiting'])),
    ]
      .map((j) => j.id)
      .sort();
    expect(jobIds).toEqual([`generate-receipt-pdf-${est}-1`, `official-qr-${est}-1`, `recalculate-day-${est}-1`]);

    // O resgate não escreve no banco: o outbox continua pendente até um consumidor existir.
    expect(await outboxCounts(infra.owner, est)).toEqual({ pendente: 3 });
    expect(await countRegistros(infra.owner, est)).toBe(1);
  });
});
