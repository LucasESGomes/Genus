/**
 * E1: 200 batidas pela rota HTTP -> entradas `pendente` -> `punches` (publicador real,
 * Valkey real) -> worker do rep-core (concorrência 4) -> `registros`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chainReport,
  countEvidencias,
  countOutbox,
  countRegistros,
  entryStatusCounts,
  nsrList,
  outboxCounts,
  range,
} from '../support/asserts';
import { startInfra, waitFor, type Infra } from '../support/infra';
import { disposer, openQueues, postPunch, startCollector, startRepCore, totalJobs } from '../support/stack';

const TENANT = 1;
const ESTABLISHMENT = 7001;
const DEVICE = 8001;
const TOTAL = 200;
const HTTP_CONCURRENCY = 8;

let infra: Infra;
const cleanup = disposer();

beforeAll(async () => {
  infra = await startInfra();
});

afterAll(async () => {
  await cleanup.run();
  await infra?.stop();
});

describe('E1: fluxo completo com 200 batidas', () => {
  it('HTTP -> entradas -> punches -> worker -> registros, sem buraco de NSR e com cadeia íntegra', async () => {
    const queues = await openQueues(infra.valkey.url);
    cleanup.add(() => queues.close());
    const collector = await startCollector(infra, { establishmentId: ESTABLISHMENT, deviceId: DEVICE });
    cleanup.add(() => collector.close());
    const core = startRepCore(infra, { concurrency: 4 });
    cleanup.add(() => core.close());

    // Aparelho enviando 200 batidas, 8 por vez.
    const statuses: number[] = [];
    const outcomes: string[] = [];
    let next = 1;
    const sender = async (): Promise<void> => {
      for (;;) {
        const seq = next++;
        if (seq > TOTAL) return;
        // marcado_em distinto por batida (até 2 s no passado, dentro da tolerância de relógio).
        const capturedAt = new Date(Date.parse('2026-11-18T12:00:00.000Z') - seq * 10).toISOString();
        const res = await postPunch(collector, seq, capturedAt);
        statuses.push(res.statusCode);
        outcomes.push((res.json() as { data?: { outcome?: string } }).data?.outcome ?? 'sem-data');
      }
    };
    await Promise.all(Array.from({ length: HTTP_CONCURRENCY }, sender));

    expect(statuses.filter((s) => s !== 200)).toEqual([]);
    expect(new Set(outcomes)).toEqual(new Set(['registered']));

    // Tudo escoado: 200 processadas e 600 jobs publicados em post-punch.
    await waitFor(
      async () => ((await entryStatusCounts(infra.owner, ESTABLISHMENT))['processado'] ?? 0) === TOTAL,
      '200 entradas processadas',
      90_000,
    );
    await waitFor(async () => (await totalJobs(queues.postPunch)) === TOTAL * 3, '600 jobs em post-punch', 60_000);

    // NSR exatamente {1..200}.
    expect(await nsrList(infra.owner, ESTABLISHMENT)).toEqual(range(1, TOTAL));
    // Cadeia de hash e invariante.
    const { report, invariant } = await chainReport(infra, TENANT, ESTABLISHMENT);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.rowsChecked).toBe(TOTAL);
    expect(report.lastNsr).toBe(TOTAL);
    expect(invariant).toEqual([]);

    expect(await countRegistros(infra.owner, ESTABLISHMENT)).toBe(TOTAL);
    expect(await countEvidencias(infra.owner, ESTABLISHMENT)).toBe(TOTAL);
    expect(await countOutbox(infra.owner, ESTABLISHMENT)).toBe(TOTAL * 3);
    expect(await outboxCounts(infra.owner, ESTABLISHMENT)).toEqual({ pendente: TOTAL * 3 });
    expect(await entryStatusCounts(infra.owner, ESTABLISHMENT)).toEqual({ processado: TOTAL });

    const postPunchCounts = await queues.postPunch.getJobCounts();
    expect(postPunchCounts['waiting']).toBe(TOTAL * 3);
    expect(await totalJobs(queues.postPunch)).toBe(TOTAL * 3);

    const punchesCounts = await queues.punches.getJobCounts();
    expect(punchesCounts['failed']).toBe(0);
    expect(punchesCounts['waiting']).toBe(0);
    expect(punchesCounts['active']).toBe(0);

    // Nada degradou no caminho feliz.
    expect(core.logs.byEvent('queue_publish_failed')).toHaveLength(0);
    expect(collector.logs.byEvent('queue_publish_failed')).toHaveLength(0);
    expect(core.logs.byEvent('punch_processed')).toHaveLength(TOTAL);
  });
});
