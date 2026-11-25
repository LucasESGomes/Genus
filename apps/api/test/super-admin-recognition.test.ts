/**
 * Super admin: reconhecimento facial, só agregados de `arp.entradas` (04 §1.4). Postgres do RH e do arp
 * reais (Testcontainers); o reader é o de produção (`PgRecognitionStatsReader`, papel arp_reader).
 */
import { FixedClock } from '@genus/shared';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgRecognitionStatsReader } from '../src/arp/recognition-reader';
import { RECOGNITION_CACHE_TTL_MS } from '../src/modules/super-admin/recognition-logs/service';
import { expectNoForbiddenKeys } from './support/json-keys';
import { fakeCpf, PortalHarness, type Org } from './support/portal';

const h = new PortalHarness({ arp: true, gestorEnabled: true });
const BASE = '/portal/super-admin/recognition';
const clock = new FixedClock(new Date());

let app: FastifyInstance;
let orgA: Org;
let orgB: Org;
let sa: { userId: number; cookie: string };
let deviceA: number;
let deviceB: number;
let seq = 0;
const cpfs: string[] = [];

/** Entrada fiscal pendente no arp, como a api do coletor grava. Só fixture. */
async function insertEntry(p: {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
  at: Date;
  status?: 'pendente' | 'processado' | 'falhou';
  divergent?: boolean;
  recognition?: number | null;
  liveness?: number | null;
}): Promise<void> {
  seq += 1;
  const cpf = fakeCpf(9_000 + seq);
  cpfs.push(cpf);
  const c = new pg.Client({ connectionString: h.arpDb!.collectorUrl });
  await c.connect();
  try {
    await c.query(
      `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id, cpf, marcado_em, recebido_em,
                             eh_hora_divergente, metodo_identificacao, nota_reconhecimento, nota_vivacidade, status)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $6, $7, 'facial', $8, $9, $10)`,
      [p.tenantId, p.establishmentId, p.deviceId, seq, cpf, p.at, p.divergent ?? false, p.recognition ?? null, p.liveness ?? null, p.status ?? 'pendente'],
    );
  } finally {
    await c.end();
  }
}

const T0 = clock.now().getTime();
const hoursAgo = (n: number) => new Date(T0 - n * 3_600_000);

beforeAll(async () => {
  await h.start();
  orgA = await h.createOrg();
  orgB = await h.createOrg();
  sa = await h.loginAsSuperAdmin();
  deviceA = await h.id("INSERT INTO rh.aparelhos (conta_id, estabelecimento_id, nome) VALUES ($1, $2, 'Totem Portaria') RETURNING id", [orgA.tenantId, orgA.establishmentId]);
  deviceB = await h.id("INSERT INTO rh.aparelhos (conta_id, estabelecimento_id, nome) VALUES ($1, $2, 'Totem Fábrica') RETURNING id", [orgB.tenantId, orgB.establishmentId]);

  // Conta A, aparelho A: 4 batidas na janela de 24 h
  await insertEntry({ tenantId: orgA.tenantId, establishmentId: orgA.establishmentId, deviceId: deviceA, at: hoursAgo(1), status: 'processado', recognition: 0.9, liveness: 0.95 });
  await insertEntry({ tenantId: orgA.tenantId, establishmentId: orgA.establishmentId, deviceId: deviceA, at: hoursAgo(1.5), status: 'processado', recognition: 0.8, liveness: 1, divergent: true });
  await insertEntry({ tenantId: orgA.tenantId, establishmentId: orgA.establishmentId, deviceId: deviceA, at: hoursAgo(3), status: 'pendente', recognition: 0.7, liveness: 0.05 });
  await insertEntry({ tenantId: orgA.tenantId, establishmentId: orgA.establishmentId, deviceId: deviceA, at: hoursAgo(26), status: 'falhou', recognition: null, liveness: null }); // fora das 24 h
  // Conta B, aparelho B
  await insertEntry({ tenantId: orgB.tenantId, establishmentId: orgB.establishmentId, deviceId: deviceB, at: hoursAgo(2), status: 'falhou', recognition: 0.5, liveness: 0.5 });
  // Conta A, outro aparelho sem cadastro no RH, há 3 dias (só na janela de 7 d)
  await insertEntry({ tenantId: orgA.tenantId, establishmentId: orgA.establishmentId, deviceId: 987_654, at: hoursAgo(72), status: 'processado', recognition: 0.6, liveness: 0.6 });

  app = await h.newApp({ clock, superAdmin: { recognition: new PgRecognitionStatsReader(h.arpReaderPool()) } });
}, 240_000);
afterAll(async () => {
  await app?.close();
  await h.stop();
});

const get = (url: string, cookie = sa.cookie) => h.call(cookie, 'GET', `${BASE}${url}`, undefined, app);

describe('guarda', () => {
  it('papéis de cliente: 403; sem sessão: 401; sem 2FA: 403 MFA_REQUIRED', async () => {
    const employee = await h.createEmployee(orgA);
    const roles = [
      await h.loginAs(orgA, 'admin', { app }),
      await h.loginAs(orgA, 'rh', { app }),
      await h.loginAs(orgA, 'gestor', { app }),
      await h.loginAs(orgA, 'contador', { app }),
      await h.loginAs(orgA, 'colaborador', { employeeId: employee.id, app }),
    ];
    for (const s of roles) {
      for (const url of ['/summary', '/series', '/devices']) expect((await get(url, s.cookie)).statusCode, url).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: `${BASE}/summary` })).statusCode).toBe(401);
    const noMfa = await h.loginAsSuperAdmin({ withMfa: false, app });
    const res = await get('/summary', noMfa.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MFA_REQUIRED');
  });
});

describe('GET /recognition/summary', () => {
  it('agrega a janela de 24 h de todas as contas, com histograma e campos indisponíveis nulos', async () => {
    const res = await get('/summary?window=24h');
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({
      window: '24h',
      punches: 4,
      byStatus: { pendente: 1, processado: 2, falhou: 1 },
      divergentClock: 1,
      notRecognized: null,
      livenessFailed: null,
      latencyP50Ms: null,
      latencyP95Ms: null,
    });
    expect(d.recognitionScore.avg).toBeCloseTo((0.9 + 0.8 + 0.7 + 0.5) / 4, 3);
    expect(d.recognitionScore.p50).toBeCloseTo(0.75, 3);
    expect(d.livenessScore.avg).toBeCloseTo((0.95 + 1 + 0.05 + 0.5) / 4, 3);
    // faixas de 0,1: 0.05 → 1ª; 0.5 → 6ª; 0.95 → 10ª; 1.0 prende na 10ª
    expect(d.livenessHistogram).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 2]);
    expect(new Date(d.to).getTime() - new Date(d.from).getTime()).toBe(86_400_000);
    expectNoForbiddenKeys(res.json());
    for (const cpf of cpfs) expect(res.body).not.toContain(cpf);
  });

  it('filtra por conta e por aparelho; janela de 7 d inclui a batida antiga', async () => {
    const a = (await get(`/summary?window=24h&tenantId=${orgA.tenantId}`)).json().data;
    expect(a.punches).toBe(3);
    const b = (await get(`/summary?window=24h&tenantId=${orgB.tenantId}`)).json().data;
    expect(b.punches).toBe(1);
    expect(b.byStatus).toEqual({ pendente: 0, processado: 0, falhou: 1 });
    const device = (await get(`/summary?window=7d&deviceId=${deviceA}`)).json().data;
    expect(device.punches).toBe(4); // inclui a de 26 h atrás
    const week = (await get(`/summary?window=7d&tenantId=${orgA.tenantId}`)).json().data;
    expect(week.punches).toBe(5);
    const est = (await get(`/summary?window=7d&establishmentId=${orgB.establishmentId}`)).json().data;
    expect(est.punches).toBe(1);
  });

  it('sem batidas: zeros e notas nulas', async () => {
    const res = await get(`/summary?window=24h&tenantId=999999`);
    const d = res.json().data;
    expect(d.punches).toBe(0);
    expect(d.recognitionScore).toEqual({ avg: null, p50: null, p05: null });
    expect(d.livenessHistogram).toEqual(Array(10).fill(0));
  });

  it('cache de 60 s: a segunda leitura não vê a batida nova; passado o TTL, vê. Toda leitura é auditada', async () => {
    const q = `/summary?window=24h&tenantId=${orgB.tenantId}&establishmentId=${orgB.establishmentId}`;
    const auditCount = async () =>
      Number(
        (
          await h.one<{ n: string }>(
            `SELECT count(*) AS n FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'recognition_stats' AND conta_id = $1 AND usuario_id = $2`,
            [orgB.tenantId, sa.userId],
          )
        ).n,
      );
    const before = await auditCount();
    const first = (await get(q)).json().data.punches;
    await insertEntry({ tenantId: orgB.tenantId, establishmentId: orgB.establishmentId, deviceId: deviceB, at: hoursAgo(0.5), status: 'processado', recognition: 0.9, liveness: 0.9 });
    expect((await get(q)).json().data.punches).toBe(first);
    clock.set(new Date(clock.now().getTime() + RECOGNITION_CACHE_TTL_MS + 1));
    expect((await get(q)).json().data.punches).toBe(first + 1);
    expect(await auditCount()).toBe(before + 3);
    const row = await h.one<{ entidade_id: string; dados_depois: Record<string, unknown> }>(
      `SELECT entidade_id, dados_depois FROM rh.auditorias WHERE entidade = 'recognition_stats' AND conta_id = $1 ORDER BY id DESC LIMIT 1`,
      [orgB.tenantId],
    );
    expect(Number(row.entidade_id)).toBe(orgB.tenantId);
    expect(row.dados_depois).toMatchObject({ view: 'summary', window: '24h', tenantId: orgB.tenantId, establishmentId: orgB.establishmentId });
  });

  it('todas as contas: auditoria com conta nula e entidade_id 0', async () => {
    await get('/summary?window=30d');
    const row = await h.one<{ entidade_id: string }>(
      `SELECT entidade_id FROM rh.auditorias WHERE entidade = 'recognition_stats' AND conta_id IS NULL AND usuario_id = $1 ORDER BY id DESC LIMIT 1`,
      [sa.userId],
    );
    expect(Number(row.entidade_id)).toBe(0);
  });

  it('janela inválida: 400', async () => {
    expect((await get('/summary?window=1y')).statusCode).toBe(400);
  });
});

describe('GET /recognition/series', () => {
  it('agrupa por hora e por dia (UTC) com notas arredondadas', async () => {
    const hourly = await get(`/series?window=24h&bucket=hour&tenantId=${orgA.tenantId}`);
    expect(hourly.statusCode).toBe(200);
    const rows = hourly.json().data as { bucketStart: string; punches: number; failed: number; avgRecognitionScore: number | null }[];
    expect(rows.reduce((s, r) => s + r.punches, 0)).toBe(3);
    for (const r of rows) {
      expect(new Date(r.bucketStart).getUTCMinutes()).toBe(0);
      expect(new Date(r.bucketStart).getUTCSeconds()).toBe(0);
      if (r.avgRecognitionScore !== null) expect(Number(r.avgRecognitionScore.toFixed(4))).toBe(r.avgRecognitionScore);
    }
    expect(rows.map((r) => r.bucketStart)).toEqual([...rows.map((r) => r.bucketStart)].sort());

    const daily = (await get(`/series?window=7d&bucket=day&tenantId=${orgA.tenantId}`)).json().data as { bucketStart: string; punches: number; failed: number }[];
    expect(daily.reduce((s, r) => s + r.punches, 0)).toBe(5);
    expect(daily.reduce((s, r) => s + r.failed, 0)).toBe(1);
    for (const r of daily) expect(r.bucketStart.endsWith('T00:00:00.000Z')).toBe(true);
    expectNoForbiddenKeys(daily);
  });

  it('bucket inválido: 400', async () => {
    expect((await get('/series?bucket=minute')).statusCode).toBe(400);
  });
});

describe('GET /recognition/devices', () => {
  it('agrega por aparelho com o nome do cadastro do RH (nulo se não houver)', async () => {
    const res = await get('/devices?window=7d');
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { tenantId: number; establishmentId: number; deviceId: number; deviceName: string | null; punches: number; failed: number; divergentClock: number; lastPunchAt: string | null }[];
    const a = data.find((r) => r.deviceId === deviceA)!;
    expect(a).toMatchObject({ tenantId: orgA.tenantId, establishmentId: orgA.establishmentId, deviceName: 'Totem Portaria', punches: 4, failed: 1, divergentClock: 1 });
    expect(new Date(a.lastPunchAt!).getTime()).toBe(hoursAgo(1).getTime());
    expect(data.find((r) => r.deviceId === deviceB)?.deviceName).toBe('Totem Fábrica');
    expect(data.find((r) => r.deviceId === 987_654)).toMatchObject({ deviceName: null, punches: 1 });
    // mais batidas primeiro
    expect(data.map((r) => r.punches)).toEqual([...data.map((r) => r.punches)].sort((x, y) => y - x));
    expectNoForbiddenKeys(res.json());
    for (const cpf of cpfs) expect(res.body).not.toContain(cpf);

    const only = (await get(`/devices?window=7d&tenantId=${orgB.tenantId}`)).json().data;
    expect(only.every((r: { tenantId: number }) => r.tenantId === orgB.tenantId)).toBe(true);
  });
});
