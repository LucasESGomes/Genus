/**
 * Super admin: auditoria entre contas. Postgres real (Testcontainers), login de verdade.
 * Papéis de cliente → 403; sem 2FA → 403 MFA_REQUIRED; sem sessão → 401. Toda leitura é auditada.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortalHarness, type Org } from './support/portal';
import { expectNoForbiddenKeys } from './support/json-keys';

const h = new PortalHarness({ gestorEnabled: true });
const BASE = '/portal/super-admin/audit-logs';

let orgA: Org;
let orgB: Org;
let sa: { userId: number; cookie: string };
let adminA: { userId: number; cookie: string };

async function seed(tenantId: number | null, entity: string, action: string, at: string, opts: { userId?: number | null; before?: object; after?: object; reason?: string } = {}) {
  return h.id(
    `INSERT INTO rh.auditorias (conta_id, usuario_id, entidade, entidade_id, acao, dados_antes, dados_depois, motivo, criado_em)
     VALUES ($1, $2, $3, 7, $4, $5::jsonb, $6::jsonb, $7, $8) RETURNING id`,
    [tenantId, opts.userId ?? null, entity, action, opts.before ? JSON.stringify(opts.before) : null, opts.after ? JSON.stringify(opts.after) : null, opts.reason ?? null, at],
  );
}

beforeAll(async () => {
  await h.start();
  orgA = await h.createOrg();
  orgB = await h.createOrg();
  sa = await h.loginAsSuperAdmin();
  adminA = await h.loginAs(orgA, 'admin');
}, 240_000);
afterAll(async () => h.stop());

describe('guarda', () => {
  it('papéis de cliente recebem 403', async () => {
    const employee = await h.createEmployee(orgA);
    const roles = [
      await h.loginAs(orgA, 'admin'),
      await h.loginAs(orgA, 'rh'),
      await h.loginAs(orgA, 'gestor'),
      await h.loginAs(orgA, 'contador'),
      await h.loginAs(orgA, 'colaborador', { employeeId: employee.id }),
    ];
    for (const s of roles) {
      const res = await h.call(s.cookie, 'GET', BASE);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }
  });

  it('sem sessão: 401', async () => {
    const res = await h.app.inject({ method: 'GET', url: BASE });
    expect(res.statusCode).toBe(401);
  });

  it('super_admin sem 2FA: 403 MFA_REQUIRED', async () => {
    const noMfa = await h.loginAsSuperAdmin({ withMfa: false });
    const res = await h.call(noMfa.cookie, 'GET', BASE);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MFA_REQUIRED');
  });
});

describe('GET /audit-logs', () => {
  it('filtra por conta, entidade, ação e usuário, com nome da conta e e-mail do usuário', async () => {
    const e = `ent_${Date.now()}`;
    await seed(orgA.tenantId, e, 'criacao', '2026-03-01T10:00:00Z', { userId: adminA.userId });
    await seed(orgA.tenantId, e, 'alteracao', '2026-03-01T11:00:00Z');
    await seed(orgB.tenantId, e, 'criacao', '2026-03-01T12:00:00Z');

    const all = await h.call(sa.cookie, 'GET', `${BASE}?entity=${e}`);
    expect(all.statusCode).toBe(200);
    expect(all.json().data).toHaveLength(3);

    const byTenant = (await h.call(sa.cookie, 'GET', `${BASE}?entity=${e}&tenantId=${orgA.tenantId}`)).json();
    expect(byTenant.data).toHaveLength(2);
    expect(byTenant.data.every((r: { tenantId: number }) => r.tenantId === orgA.tenantId)).toBe(true);
    expect(byTenant.data[0].tenantName).toBe('Conta Teste');

    const byAction = (await h.call(sa.cookie, 'GET', `${BASE}?entity=${e}&action=alteracao`)).json();
    expect(byAction.data).toHaveLength(1);

    const byUser = (await h.call(sa.cookie, 'GET', `${BASE}?entity=${e}&userId=${adminA.userId}`)).json();
    expect(byUser.data).toHaveLength(1);
    expect(byUser.data[0].userEmail).toMatch(/^admin\d+@portal\.teste\.dev$/);
    expectNoForbiddenKeys(byUser);
  });

  it('período [from, to): inclui from, exclui to', async () => {
    const e = `per_${Date.now()}`;
    await seed(orgA.tenantId, e, 'criacao', '2026-04-01T00:00:00Z');
    await seed(orgA.tenantId, e, 'criacao', '2026-04-02T00:00:00Z');
    const res = await h.call(sa.cookie, 'GET', `${BASE}?entity=${e}&from=${encodeURIComponent('2026-04-01T00:00:00Z')}&to=${encodeURIComponent('2026-04-02T00:00:00Z')}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('período maior que 90 dias ou invertido: 400 VALIDATION_ERROR', async () => {
    const q = (from: string, to: string) => `${BASE}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const long = await h.call(sa.cookie, 'GET', q('2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z'));
    expect(long.statusCode).toBe(400);
    expect(long.json().code).toBe('VALIDATION_ERROR');
    const inverted = await h.call(sa.cookie, 'GET', q('2026-05-01T00:00:00Z', '2026-04-01T00:00:00Z'));
    expect(inverted.statusCode).toBe(400);
    const ok = await h.call(sa.cookie, 'GET', q('2026-01-01T00:00:00Z', '2026-03-31T00:00:00Z'));
    expect(ok.statusCode).toBe(200);
  });

  it('cursor por id decrescente: páginas sem repetição; a última página cheia ainda traz nextCursor', async () => {
    const e = `cur_${Date.now()}`;
    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(await seed(orgB.tenantId, e, 'criacao', `2026-05-0${i + 1}T10:00:00Z`));
    const seen: number[] = [];
    let cursor: number | null = null;
    let pages = 0;
    do {
      const res: { data: { id: number }[]; meta: { nextCursor: number | null; limit: number } } = (
        await h.call(sa.cookie, 'GET', `${BASE}?entity=${e}&limit=2${cursor ? `&cursor=${cursor}` : ''}`)
      ).json();
      expect(res.meta.limit).toBe(2);
      seen.push(...res.data.map((r) => r.id));
      cursor = res.meta.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(seen).toEqual([...ids].reverse());
    expect(pages).toBe(3);
  });

  it('leitura entre contas grava UMA linha leitura_sensivel com os filtros, sem e-mail', async () => {
    const e = `aud_${Date.now()}`;
    await seed(orgA.tenantId, e, 'criacao', '2026-06-01T10:00:00Z');
    const countRows = (tenantId: number | null) =>
      h.one<{ n: string }>(
        `SELECT count(*) AS n FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'audit_log' AND usuario_id = $1 AND conta_id IS NOT DISTINCT FROM $2`,
        [sa.userId, tenantId],
      ).then((r) => Number(r.n));

    const beforeA = await countRows(orgA.tenantId);
    await h.call(sa.cookie, 'GET', `${BASE}?tenantId=${orgA.tenantId}&entity=${e}`);
    expect(await countRows(orgA.tenantId)).toBe(beforeA + 1);
    const row = await h.one<{ entidade_id: string; dados_depois: Record<string, unknown> }>(
      `SELECT entidade_id, dados_depois FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'audit_log' AND usuario_id = $1 AND conta_id = $2 ORDER BY id DESC LIMIT 1`,
      [sa.userId, orgA.tenantId],
    );
    expect(Number(row.entidade_id)).toBe(orgA.tenantId);
    expect(row.dados_depois).toMatchObject({ tenantId: orgA.tenantId, entity: e });
    expect(JSON.stringify(row.dados_depois)).not.toContain('@');

    const beforeAll = await countRows(null);
    await h.call(sa.cookie, 'GET', BASE);
    expect(await countRows(null)).toBe(beforeAll + 1);
    const global = await h.one<{ entidade_id: string }>(
      `SELECT entidade_id FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'audit_log' AND usuario_id = $1 AND conta_id IS NULL ORDER BY id DESC LIMIT 1`,
      [sa.userId],
    );
    expect(Number(global.entidade_id)).toBe(0);
  });
});

describe('GET /audit-logs/:id', () => {
  it('devolve o detalhe com before/after redigidos de novo e audita a leitura', async () => {
    const id = await seed(orgA.tenantId, 'employee', 'alteracao', '2026-06-02T10:00:00Z', {
      userId: adminA.userId,
      before: { cpf: '12345678901', nome: 'Pessoa Fictícia' },
      after: { cpf: '12345678901', pinHash: 'abc', nome: 'Outra' },
      reason: 'ajuste',
    });
    const res = await h.call(sa.cookie, 'GET', `${BASE}/${id}`);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.before).toEqual({ cpf: '[alterado]', nome: 'Pessoa Fictícia' });
    expect(d.after).toEqual({ cpf: '[alterado]', pinHash: '[alterado]', nome: 'Outra' });
    expect(d.reason).toBe('ajuste');
    expect(JSON.stringify(res.json())).not.toContain('12345678901');
    const audited = await h.one<{ n: string }>(
      `SELECT count(*) AS n FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'audit_log' AND entidade_id = $1 AND usuario_id = $2`,
      [id, sa.userId],
    );
    expect(Number(audited.n)).toBe(1);
  });

  it('linha inexistente: 404', async () => {
    const res = await h.call(sa.cookie, 'GET', `${BASE}/999999999`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('id inválido: 400', async () => {
    expect((await h.call(sa.cookie, 'GET', `${BASE}/abc`)).statusCode).toBe(400);
  });
});
