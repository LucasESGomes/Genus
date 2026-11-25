/**
 * Super admin: GET /system-health. Sondas HTTP falsas (servidores locais), readers reais do arp
 * (papel arp_reader) e Postgres real. A resposta nunca traz URL, credencial nem texto de exceção.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PgArpOpsReader } from '../src/arp/ops-reader';
import type { ArpOpsReader, QueueCounts, QueueInspector, SuperAdminDeps } from '../src/modules/super-admin/deps';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const clock = new FixedClock('2026-11-25T12:00:00Z');
const h = new PortalHarness({ arp: true, clock });
const URL_PATH = '/portal/super-admin/system-health';

let org: Org;
let sa: { userId: number; cookie: string };
let owner: pg.Client;
const servers: Server[] = [];
const apps: FastifyInstance[] = [];

/** Servidor HTTP local que responde `body` em /health, depois de `delayMs`. */
async function stub(body: unknown, opts: { status?: number; delayMs?: number } = {}): Promise<string> {
  const server = createServer((_req, res) => {
    setTimeout(() => {
      res.writeHead(opts.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    }, opts.delayMs ?? 0);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Porta que acabou de ser liberada: ninguém escuta, a conexão é recusada. */
async function closedPortUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

const engineOk = { status: 'ok', models: { detector: true } };
const collectorOk = { data: { status: 'ok', checks: { api: 'ok', database: 'ok', engine: 'ok' } } };

const idleQueues = (over: Partial<QueueCounts> = {}): QueueInspector => ({
  ping: async () => undefined,
  counts: async () => ({ waiting: 0, active: 0, delayed: 0, failed: 0, oldestWaitingAgeSeconds: null, ...over }),
});

const idleArp = (over: Partial<ArpOpsReader> = {}): ArpOpsReader => ({
  ping: async () => undefined,
  punchesPerDay: async () => [],
  pendingEntries: async () => ({ count: 0, oldestAgeSeconds: null }),
  pendingOutbox: async () => ({ count: 0, oldestAgeSeconds: null }),
  ...over,
});

async function health(over: Partial<SuperAdminDeps>, cookie = sa.cookie) {
  const app = await h.newApp({ clock, superAdmin: { clock, ...over } });
  apps.push(app);
  const res = await h.call(cookie, 'GET', URL_PATH, undefined, app);
  return res;
}

type Check = { service: string; status: string; latencyMs: number | null; detail: string | null; metrics: Record<string, number> | null };
const checkOf = (res: { json(): { data: { checks: Check[] } } }, service: string) => res.json().data.checks.find((c) => c.service === service)!;

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  sa = await h.loginAsSuperAdmin();
  owner = new pg.Client({ connectionString: h.arpDb!.ownerUrl });
  await owner.connect();
}, 240_000);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  await owner.query('DELETE FROM outbox');
});

afterAll(async () => {
  await owner?.end();
  await h.stop();
});

describe('GET /system-health', () => {
  it('tudo ok com sondas e filas de mentira', async () => {
    const res = await health({
      probes: { engineUrl: await stub(engineOk), collectorUrl: await stub(collectorOk) },
      queues: idleQueues(),
      arpOps: idleArp(),
    });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.status).toBe('ok');
    expect(d.version).toBe('0.0.0-test');
    expect(d.checkedAt).toBe(clock.now().toISOString());
    expect(d.uptimeSeconds).toBe(Math.floor((clock.now().getTime() - new Date('2026-01-01T00:00:00Z').getTime()) / 1000));
    expect(d.checks.map((c: Check) => c.service)).toEqual(['api', 'postgres_app', 'postgres_arp', 'valkey', 'face_engine', 'collector_api', 'rep_core', 'jobs']);
    for (const c of d.checks as Check[]) expect(c.status, c.service).toBe('ok');
    expect(checkOf(res, 'rep_core').metrics).toMatchObject({ pendingEntries: 0, waiting: 0, active: 0, delayed: 0, failed: 0 });
    expect(checkOf(res, 'api').metrics).toHaveProperty('uptimeSeconds');
  });

  it('engine fora do ar (porta fechada): down dentro do prazo e o geral fica down', async () => {
    const started = Date.now();
    const res = await health({ probes: { engineUrl: await closedPortUrl(), collectorUrl: await stub(collectorOk) }, queues: idleQueues(), arpOps: idleArp() });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(checkOf(res, 'face_engine')).toMatchObject({ status: 'down', detail: 'Não foi possível consultar o serviço.' });
    expect(res.json().data.status).toBe('down');
    expect(checkOf(res, 'collector_api').status).toBe('ok');
  });

  it('sonda que não responde no prazo: down por tempo esgotado', async () => {
    const res = await health({
      probes: { engineUrl: await stub(engineOk, { delayMs: 1500 }), collectorUrl: null },
      queues: idleQueues(),
      arpOps: idleArp(),
      healthTimeoutMs: 300,
    });
    const c = checkOf(res, 'face_engine');
    expect(c.status).toBe('down');
    expect(c.detail).toBe('Sem resposta dentro do prazo.');
    expect(c.latencyMs).toBeGreaterThanOrEqual(250);
    expect(c.latencyMs).toBeLessThan(1000);
  });

  it('sonda lenta (acima de 1 s) mas dentro do prazo: degraded', async () => {
    const res = await health({
      probes: { engineUrl: await stub(engineOk, { delayMs: 1100 }), collectorUrl: null },
      queues: idleQueues(),
      arpOps: idleArp(),
      healthTimeoutMs: 3000,
    });
    expect(checkOf(res, 'face_engine').status).toBe('degraded');
  });

  it('engine que diz degraded, ou responde 500: degraded e down', async () => {
    const degraded = await health({ probes: { engineUrl: await stub({ status: 'degraded', models: {} }), collectorUrl: null }, queues: idleQueues(), arpOps: idleArp() });
    expect(checkOf(degraded, 'face_engine')).toMatchObject({ status: 'degraded', detail: 'Engine está degradada.' });
    const broken = await health({ probes: { engineUrl: await stub({}, { status: 500 }), collectorUrl: null }, queues: idleQueues(), arpOps: idleArp() });
    expect(checkOf(broken, 'face_engine')).toMatchObject({ status: 'down', detail: 'Engine respondeu com erro.' });
  });

  it('URLs não configuradas: degraded, sem latência', async () => {
    const res = await health({ probes: { engineUrl: null, collectorUrl: null }, queues: idleQueues(), arpOps: idleArp() });
    expect(checkOf(res, 'face_engine')).toMatchObject({ status: 'degraded', latencyMs: null, detail: 'não configurado' });
    expect(checkOf(res, 'collector_api')).toMatchObject({ status: 'degraded', latencyMs: null });
  });

  it('sem Valkey configurado: valkey degraded e rep-core/jobs só pelo arp', async () => {
    const res = await health({ queues: null, arpOps: idleArp() });
    expect(checkOf(res, 'valkey')).toMatchObject({ status: 'degraded', latencyMs: null, detail: 'VALKEY_URL não configurada' });
    expect(checkOf(res, 'rep_core').status).toBe('ok');
    expect(checkOf(res, 'rep_core').detail).toContain('Valkey não configurado');
  });

  it('Valkey que falha: valkey down, rep-core e jobs degraded', async () => {
    const queues: QueueInspector = {
      ping: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.9:6379 password=segredo');
      },
      counts: async () => {
        throw new Error('Connection is closed.');
      },
    };
    const res = await health({ queues, arpOps: idleArp() });
    expect(checkOf(res, 'valkey').status).toBe('down');
    expect(checkOf(res, 'rep_core').status).toBe('degraded');
    expect(checkOf(res, 'jobs').status).toBe('degraded');
    expect(res.body).not.toMatch(/ECONNREFUSED|10\.0\.0\.9|segredo|closed/);
  });

  it('atraso no arp: rep-core down e jobs degraded', async () => {
    const res = await health({
      queues: idleQueues({ waiting: 3, oldestWaitingAgeSeconds: 9 }),
      arpOps: idleArp({
        pendingEntries: async () => ({ count: 4, oldestAgeSeconds: 700 }),
        pendingOutbox: async () => ({ count: 2, oldestAgeSeconds: 130 }),
      }),
    });
    expect(checkOf(res, 'rep_core')).toMatchObject({ status: 'down', metrics: { pendingEntries: 4, oldestPendingAgeSeconds: 700, waiting: 3, oldestWaitingAgeSeconds: 9 } });
    expect(checkOf(res, 'jobs')).toMatchObject({ status: 'degraded', metrics: { pendingOutbox: 2, oldestPendingAgeSeconds: 130 } });
    expect(res.json().data.status).toBe('down');
  });

  it('com o reader real do arp: lê entrada e outbox pendentes', async () => {
    await owner.query(
      `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id, cpf, marcado_em, recebido_em, metodo_identificacao, criado_em)
       VALUES ($1, $2, 1, 900001, 1, '12345678909', now(), now(), 'facial', now() - interval '120 seconds')`,
      [org.tenantId, org.establishmentId],
    );
    await owner.query(
      `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload, criado_em)
       VALUES ($1, $2, 'recalculate-day', 'k-900001', '{}', now() - interval '30 seconds')`,
      [org.tenantId, org.establishmentId],
    );
    try {
      const res = await health({ queues: idleQueues(), arpOps: new PgArpOpsReader(h.arpReaderPool()) });
      const rep = checkOf(res, 'rep_core');
      expect(rep.status).toBe('degraded');
      expect(rep.metrics?.pendingEntries).toBe(1);
      expect(rep.metrics?.oldestPendingAgeSeconds).toBeGreaterThanOrEqual(119);
      expect(checkOf(res, 'jobs')).toMatchObject({ status: 'ok', metrics: { pendingOutbox: 1 } });
      expect(checkOf(res, 'postgres_arp').status).toBe('ok');
      expect(checkOf(res, 'postgres_app').status).toBe('ok');
    } finally {
      await owner.query("DELETE FROM entradas WHERE sequencia_aparelho = 900001");
    }
  });

  it('a resposta não traz URL, senha nem texto de exceção', async () => {
    const res = await health({
      probes: { engineUrl: await closedPortUrl(), collectorUrl: await stub({}, { status: 503 }) },
      queues: idleQueues(),
      arpOps: idleArp({
        ping: async () => {
          throw new Error('password authentication failed for user "arp_reader" at postgres://arp_reader:abc@db:5432/arp');
        },
      }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/https?:\/\/|127\.0\.0\.1|postgres:|password|authentication|ECONNREFUSED|arp_reader|fetch failed/i);
    expect(checkOf(res, 'postgres_arp').status).toBe('down');
  });

  it('cache de 5 s: a segunda chamada reaproveita o resultado; depois de 5 s, refaz', async () => {
    let pings = 0;
    const app = await h.newApp({ clock, superAdmin: { clock, queues: idleQueues(), arpOps: idleArp({ ping: async () => void (pings += 1) }) } });
    apps.push(app);
    const first = (await h.call(sa.cookie, 'GET', URL_PATH, undefined, app)).json().data;
    clock.advance(4000);
    const second = (await h.call(sa.cookie, 'GET', URL_PATH, undefined, app)).json().data;
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(pings).toBe(1);
    expect(second.uptimeSeconds).toBe(first.uptimeSeconds + 4); // o uptime não fica congelado
    clock.advance(1500);
    const third = (await h.call(sa.cookie, 'GET', URL_PATH, undefined, app)).json().data;
    expect(third.checkedAt).not.toBe(first.checkedAt);
    expect(pings).toBe(2);
  });

  it('guarda: cliente 403, anônimo 401, super_admin sem 2FA 403 MFA_REQUIRED', async () => {
    const rh = await h.loginAs(org, 'rh');
    const noMfa = await h.loginAsSuperAdmin({ withMfa: false });
    expect((await health({}, rh.cookie)).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: URL_PATH })).statusCode).toBe(401);
    const res = await health({}, noMfa.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MFA_REQUIRED');
  });
});
