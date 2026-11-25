/**
 * Super admin: estatísticas (stats/overview, stats/tenants/:id, stats/growth). Postgres real do app e
 * do arp (Testcontainers), reader real do arp. Só agregados; a leitura de uma conta é auditada.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgArpOpsReader } from '../src/arp/ops-reader';
import { findSensitiveKeys } from './fixtures/super-admin';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const NOW = '2026-11-25T12:00:00Z';
const h = new PortalHarness({ arp: true, clock: new FixedClock(NOW) });
const BASE = '/portal/super-admin/stats';

let orgA: Org;
let orgB: Org;
let sa: { userId: number; cookie: string };
let owner: pg.Client;
let seq = 0;

/** Entrada fictícia no arp (papel dono). */
async function entry(org: Org, at: string, status: 'pendente' | 'processado') {
  seq += 1;
  await owner.query(
    `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id, cpf, marcado_em, recebido_em,
                           metodo_identificacao, status)
     VALUES ($1, $2, 1, $3, 1, '12345678909', $4, $4, 'facial', $5)`,
    [org.tenantId, org.establishmentId, seq, at, status],
  );
}

beforeAll(async () => {
  await h.start();
  orgA = await h.createOrg();
  orgB = await h.createOrg();
  await h.client.query("UPDATE rh.contas SET nome = 'Fazenda A', criado_em = '2026-09-10T10:00:00Z' WHERE id = $1", [orgA.tenantId]);
  await h.client.query("UPDATE rh.contas SET nome = 'Fazenda B', criado_em = '2026-11-05T10:00:00Z' WHERE id = $1", [orgB.tenantId]);

  const rhA = await h.loginAs(orgA, 'rh');
  await h.loginAs(orgB, 'rh');
  sa = await h.loginAsSuperAdmin();

  // A: 3 colaboradores (1 desligado). B: 1.
  await h.createEmployee(orgA, { admissionDate: '2026-09-15' });
  await h.createEmployee(orgA, { admissionDate: '2026-09-20' });
  const gone = await h.createEmployee(orgA, { admissionDate: '2026-11-02' });
  await h.client.query("UPDATE rh.colaboradores SET data_desligamento = '2026-11-20', motivo_desligamento = 'pedido' WHERE id = $1", [gone.id]);
  await h.createEmployee(orgB, { admissionDate: '2026-08-01' });

  // Aparelhos: A com 2 (1 ativo); fechamento aberto, afastamento e ajuste na janela.
  await h.client.query("INSERT INTO rh.aparelhos (conta_id, estabelecimento_id, nome, ativo) VALUES ($1, $2, 'Totem 1', true), ($1, $2, 'Totem 2', false)", [
    orgA.tenantId,
    orgA.establishmentId,
  ]);
  await h.client.query(
    "INSERT INTO rh.fechamentos (conta_id, estabelecimento_id, competencia, data_inicio, data_fim, status) VALUES ($1, $2, '2026-11-01', '2026-11-01', '2026-11-30', 'aberto')",
    [orgA.tenantId, orgA.establishmentId],
  );
  const empA = await h.one<{ id: string }>('SELECT id FROM rh.colaboradores WHERE conta_id = $1 ORDER BY id LIMIT 1', [orgA.tenantId]);
  await h.client.query("INSERT INTO rh.afastamentos (conta_id, colaborador_id, tipo, data_inicio, data_fim) VALUES ($1, $2, 'outro', '2026-11-25', '2026-11-26')", [
    orgA.tenantId,
    Number(empA.id),
  ]);
  await h.client.query(
    "INSERT INTO rh.ajustes (conta_id, colaborador_id, data, tipo, motivo, solicitado_por, solicitado_em) VALUES ($1, $2, '2026-11-24', 'justificativa', 'texto livre sigiloso', $3, '2026-11-25T08:00:00Z')",
    [orgA.tenantId, Number(empA.id), rhA.userId],
  );

  // Batidas no arp. A: 3 hoje (2 processadas) + 1 ontem + 1 fora da janela. B: 1 hoje.
  owner = new pg.Client({ connectionString: h.arpDb!.ownerUrl });
  await owner.connect();
  await entry(orgA, '2026-11-25T08:00:00Z', 'processado');
  await entry(orgA, '2026-11-25T08:05:00Z', 'processado');
  await entry(orgA, '2026-11-25T08:10:00Z', 'pendente');
  await entry(orgA, '2026-11-24T15:00:00Z', 'processado');
  await entry(orgA, '2026-11-20T15:00:00Z', 'processado');
  await entry(orgB, '2026-11-25T09:00:00Z', 'processado');

  // Suspende B (a constraint exige motivo e data coerentes).
  await h.client.query("UPDATE rh.contas SET ativo = false, motivo_suspensao = 'inadimplência', suspensa_em = '2026-11-21T10:00:00Z' WHERE id = $1", [orgB.tenantId]);

  // Esta app lê o arp pelo papel `arp_reader`, como em produção.
  h.app = await h.newApp({ superAdmin: { arpOps: new PgArpOpsReader(h.arpReaderPool()) } });
}, 240_000);

afterAll(async () => {
  await owner?.end();
  await h.stop();
});

const get = (url: string, cookie = sa.cookie) => h.call(cookie, 'GET', url);

describe('GET /stats/overview', () => {
  it('conta contas, colaboradores, aparelhos, usuários, batidas e uso dos módulos', async () => {
    const res = await get(`${BASE}/overview`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.window).toBe('24h');
    expect(d.tenants).toEqual({ total: 2, active: 1, suspended: 1 });
    expect(d.employees).toBe(3); // A: 2 ativos; B: 1
    expect(d.devices).toEqual({ total: 2, active: 1 });
    expect(d.users).toBe(2); // o super_admin (sem conta) fica de fora
    expect(d.punches).toBe(5);
    expect(d.processedRate).toBe(0.8);
    expect(d.punchesPerDay).toEqual([
      { day: '2026-11-24', punches: 1 },
      { day: '2026-11-25', punches: 4 },
    ]);
    expect(d.pendingClosings).toBe(1);
    expect(d.moduleUsage).toEqual({ adjustments: 1, certificates: 0, vacations: 0, absences: 1, closings: 0 });
    expect(d.topTenants).toEqual([
      { tenantId: orgA.tenantId, name: 'Fazenda A', punches: 4, employees: 2 },
      { tenantId: orgB.tenantId, name: 'Fazenda B', punches: 1, employees: 1 },
    ]);
    expect(findSensitiveKeys(res.json())).toEqual([]);
    expect(res.body).not.toContain('sigiloso');
  });

  it('janela de 7 dias inclui as batidas de 20/11 e preenche os dias sem batida com 0', async () => {
    const d = (await get(`${BASE}/overview?window=7d`)).json().data;
    expect(d.punches).toBe(6);
    expect(d.punchesPerDay.map((x: { day: string }) => x.day)).toEqual([
      '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25',
    ]);
    expect(d.punchesPerDay.find((x: { day: string }) => x.day === '2026-11-21').punches).toBe(0);
  });

  it('não grava auditoria (agregado da plataforma)', async () => {
    const before = await h.one<{ n: string }>("SELECT COUNT(*) AS n FROM rh.auditorias WHERE entidade = 'tenant_stats'");
    await get(`${BASE}/overview`);
    await get(`${BASE}/growth`);
    const after = await h.one<{ n: string }>("SELECT COUNT(*) AS n FROM rh.auditorias WHERE entidade = 'tenant_stats'");
    expect(after.n).toBe(before.n);
  });

  it('janela inválida: 400', async () => {
    expect((await get(`${BASE}/overview?window=1y`)).statusCode).toBe(400);
  });
});

describe('GET /stats/tenants/:tenantId', () => {
  it('traz só os números da conta e grava uma leitura_sensivel', async () => {
    const res = await get(`${BASE}/tenants/${orgA.tenantId}`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({
      tenantId: orgA.tenantId,
      window: '24h',
      employees: 2,
      devices: { total: 2, active: 1 },
      users: 1,
      punches: 4,
      processedRate: 0.75,
      pendingClosings: 1,
      moduleUsage: { adjustments: 1, certificates: 0, vacations: 0, absences: 1, closings: 0 },
    });
    expect(d.punchesPerDay).toEqual([
      { day: '2026-11-24', punches: 1 },
      { day: '2026-11-25', punches: 3 },
    ]);
    const rows = (await h.client.query("SELECT conta_id, usuario_id, entidade_id, acao FROM rh.auditorias WHERE entidade = 'tenant_stats' AND conta_id = $1", [orgA.tenantId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ usuario_id: String(sa.userId), entidade_id: String(orgA.tenantId), acao: 'leitura_sensivel' });
  });

  it('conta sem batida na janela: taxa nula', async () => {
    const d = (await get(`${BASE}/tenants/${orgB.tenantId}?window=24h`)).json().data;
    expect(d.punches).toBe(1);
    expect(d.processedRate).toBe(1);
    expect(d.employees).toBe(1);
  });

  it('conta inexistente: 404 NOT_FOUND e nenhuma auditoria', async () => {
    const res = await get(`${BASE}/tenants/999999`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    const n = await h.one<{ n: string }>("SELECT COUNT(*) AS n FROM rh.auditorias WHERE entidade = 'tenant_stats' AND entidade_id = 999999");
    expect(n.n).toBe('0');
  });
});

describe('GET /stats/growth', () => {
  it('série mensal com acumulado', async () => {
    const res = await get(`${BASE}/growth?months=3`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      { month: '2026-09', newTenants: 1, totalTenants: 1, newEmployees: 2, totalEmployees: 3 },
      { month: '2026-10', newTenants: 0, totalTenants: 1, newEmployees: 0, totalEmployees: 3 },
      { month: '2026-11', newTenants: 1, totalTenants: 2, newEmployees: 1, totalEmployees: 4 },
    ]);
  });

  it('months fora de 1 a 36: 400', async () => {
    expect((await get(`${BASE}/growth?months=0`)).statusCode).toBe(400);
    expect((await get(`${BASE}/growth?months=37`)).statusCode).toBe(400);
  });
});

describe('guarda', () => {
  it('cliente: 403; anônimo: 401; super_admin sem 2FA: 403 MFA_REQUIRED', async () => {
    const rh = await h.loginAs(orgA, 'rh');
    const noMfa = await h.loginAsSuperAdmin({ withMfa: false });
    expect((await get(`${BASE}/overview`, rh.cookie)).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: `${BASE}/overview` })).statusCode).toBe(401);
    const res = await get(`${BASE}/overview`, noMfa.cookie);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MFA_REQUIRED');
  });
});
