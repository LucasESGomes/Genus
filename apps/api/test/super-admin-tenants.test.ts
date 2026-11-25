/**
 * Contas (tenants) do painel do super_admin: CRUD, busca, criação transacional com chave da empresa e admin,
 * suspensão (sessões derrubadas, login recusado), auditoria, guarda e ausência de segredo nas respostas.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL, PASSWORD, PortalHarness, TEST_MASTER_KEY, type Org } from './support/portal';
import { createTenantBody, findSensitiveKeys, invalidCnpj, validCnpj } from './fixtures/super-admin';

const h = new PortalHarness();
const BASE = '/portal/super-admin/tenants';
let root: { userId: number; cookie: string };
let n = 100;

beforeAll(async () => {
  await h.start();
  root = await h.loginAsSuperAdmin();
}, 240_000);
afterAll(async () => h.stop());

const post = (body: unknown, cookie = root.cookie) => h.call(cookie, 'POST', BASE, body);
const signIn = (email: string, password: string) =>
  h.app.inject({ method: 'POST', url: '/auth/sign-in/email', headers: { origin: BASE_URL }, payload: { email, password } });

async function createTenant(over: Parameters<typeof createTenantBody>[0] = {}) {
  n += 1;
  const res = await post(createTenantBody({ n, ...over }));
  expect(res.statusCode).toBe(201);
  return { body: res.json().data as { tenant: { id: number }; admin: { id: number; email: string }; temporaryPassword: string }, n };
}

describe('POST /tenants', () => {
  it('cria conta, empresa, estabelecimento, DEK e admin numa transação; o admin entra com a senha temporária', async () => {
    const { body, n: k } = await createTenant();
    const tenantId = body.tenant.id;
    expect(body.temporaryPassword).toHaveLength(16);
    expect(findSensitiveKeys(body, ['temporaryPassword'])).toEqual([]);

    const keys = await h.one<{ c: string }>('SELECT count(*) c FROM rh.chaves_empresa WHERE conta_id = $1 AND eh_ativa', [tenantId]);
    expect(Number(keys.c)).toBe(1);
    expect(await h.one('SELECT 1 x FROM rh.estabelecimentos WHERE conta_id = $1', [tenantId])).toBeTruthy();
    const dto = body.tenant as unknown as { hasCompanyKey: boolean; companies: { cnpj: string }[]; admins: { role: string; email: string; mfaEnabled: boolean }[]; counts: Record<string, number>; status: string };
    expect(dto).toMatchObject({ status: 'ativa', hasCompanyKey: true, counts: { employees: 0, devices: 0, users: 1, establishments: 1 } });
    expect(dto.companies[0]!.cnpj).toBe(validCnpj(k));
    expect(dto.admins).toEqual([expect.objectContaining({ role: 'admin', email: `admin.${k}@cliente.teste.dev`, mfaEnabled: false })]);

    const login = await signIn(body.admin.email, body.temporaryPassword);
    expect(login.statusCode).toBe(200);

    const audits = await h.client.query('SELECT entidade, acao, usuario_id FROM rh.auditorias WHERE conta_id = $1 ORDER BY id', [tenantId]);
    expect(audits.rows).toEqual([
      { entidade: 'tenant', acao: 'criacao', usuario_id: String(root.userId) },
      { entidade: 'tenant_admin', acao: 'criacao', usuario_id: String(root.userId) },
    ]);
    // senha temporária nunca em claro no banco nem no log
    expect(JSON.stringify((await h.client.query('SELECT dados_depois FROM rh.auditorias WHERE conta_id = $1', [tenantId])).rows)).not.toContain(body.temporaryPassword);
    h.expectLogsWithout(body.temporaryPassword);
  });

  it('503 MASTER_KEY_AUSENTE sem a chave mestra', async () => {
    const app = await h.newApp({ superAdmin: { masterKeyHex: null } });
    const s = await h.loginAsSuperAdmin({ app });
    const res = await h.call(s.cookie, 'POST', BASE, createTenantBody({ n: 900 }), app);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('MASTER_KEY_AUSENTE');
    await app.close();
  });

  it('400 CNPJ_INVALIDO e 409 EMAIL_IN_USE (sem deixar conta pela metade)', async () => {
    const bad = createTenantBody({ n: 901 });
    bad.company.cnpj = invalidCnpj();
    const r1 = await post(bad);
    expect(r1.statusCode).toBe(400);
    expect(r1.json().code).toBe('CNPJ_INVALIDO');

    const { body, n: k } = await createTenant();
    const before = Number((await h.one<{ c: string }>('SELECT count(*) c FROM rh.contas')).c);
    const dup = await post(createTenantBody({ n: 950, admin: { name: 'Outro', email: body.admin.email } }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('EMAIL_IN_USE');
    expect(Number((await h.one<{ c: string }>('SELECT count(*) c FROM rh.contas')).c)).toBe(before);
    expect(k).toBeGreaterThan(0);
  });

  it('400 em corpo inválido', async () => {
    expect((await post({})).statusCode).toBe(400);
  });
});

describe('GET /tenants', () => {
  it('busca sem acento, filtra por status, pagina e conta sem N+1', async () => {
    const a = await createTenant({ name: 'Fazenda São João Teste' });
    const b = await createTenant({ name: 'Usina Boa Vista Teste' });
    await h.call(root.cookie, 'POST', `${BASE}/${b.body.tenant.id}/suspend`, { reason: 'inadimplência' });
    const org: Org = { tenantId: a.body.tenant.id, companyId: 0, establishmentId: 0, otherEstablishmentId: 0, departmentId: 0, jobTitleId: 0, costCenterId: 0 };
    const est = await h.id('SELECT id FROM rh.estabelecimentos WHERE conta_id = $1', [org.tenantId]);
    await h.createEmployee({ ...org, establishmentId: est });
    const gone = await h.createEmployee({ ...org, establishmentId: est });
    await h.client.query("UPDATE rh.colaboradores SET data_desligamento = '2025-01-01', motivo_desligamento = 'x' WHERE id = $1", [gone.id]);
    await h.client.query('INSERT INTO rh.aparelhos (conta_id, estabelecimento_id, nome) VALUES ($1, $2, $3)', [org.tenantId, est, 'Totem 1']);

    const found = await h.call(root.cookie, 'GET', `${BASE}?q=sao%20joao`);
    expect(found.statusCode).toBe(200);
    const rows = found.json().data as { id: number; counts: Record<string, number> }[];
    expect(rows.map((r) => r.id)).toEqual([a.body.tenant.id]);
    expect(rows[0]!.counts).toEqual({ employees: 1, devices: 1, users: 1, establishments: 1 });
    expect(found.json().meta).toMatchObject({ page: 1, total: 1 });

    const susp = (await h.call(root.cookie, 'GET', `${BASE}?status=suspensa&q=usina`)).json();
    expect(susp.data.map((r: { id: number }) => r.id)).toEqual([b.body.tenant.id]);
    expect(susp.data[0]).toMatchObject({ status: 'suspensa', suspensionReason: 'inadimplência' });
    expect((await h.call(root.cookie, 'GET', `${BASE}?status=ativa&q=usina`)).json().data).toEqual([]);

    const p1 = (await h.call(root.cookie, 'GET', `${BASE}?page=1&pageSize=2`)).json();
    const p2 = (await h.call(root.cookie, 'GET', `${BASE}?page=2&pageSize=2`)).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.meta.total).toBeGreaterThanOrEqual(4);
    expect(p2.data[0].id).toBeLessThan(p1.data[1].id);
    expect(findSensitiveKeys(p1)).toEqual([]);
  });
});

describe('GET/PATCH /tenants/:id', () => {
  it('lê, renomeia com auditoria antes/depois e 404 em conta inexistente', async () => {
    const { body } = await createTenant();
    const id = body.tenant.id;
    const get = await h.call(root.cookie, 'GET', `${BASE}/${id}`);
    expect(get.statusCode).toBe(200);
    expect(findSensitiveKeys(get.json())).toEqual([]);

    const patch = await h.call(root.cookie, 'PATCH', `${BASE}/${id}`, { name: 'Nome Novo' });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().data.name).toBe('Nome Novo');
    const audit = await h.one<{ dados_antes: { name: string }; dados_depois: { name: string } }>(
      "SELECT dados_antes, dados_depois FROM rh.auditorias WHERE conta_id = $1 AND entidade = 'tenant' AND acao = 'alteracao'",
      [id],
    );
    expect(audit.dados_depois.name).toBe('Nome Novo');
    expect(audit.dados_antes.name).not.toBe('Nome Novo');

    expect((await h.call(root.cookie, 'GET', `${BASE}/999999`)).statusCode).toBe(404);
    expect((await h.call(root.cookie, 'PATCH', `${BASE}/999999`, { name: 'Xx' })).statusCode).toBe(404);
    expect((await h.call(root.cookie, 'POST', `${BASE}/999999/suspend`, { reason: 'motivo' })).statusCode).toBe(404);
  });
});

describe('suspender e reativar', () => {
  it('derruba sessões, recusa sessão e login novo, e volta ao reativar; 409 nos estados errados', async () => {
    const { body } = await createTenant();
    const id = body.tenant.id;
    const login = await signIn(body.admin.email, body.temporaryPassword);
    const cookie = login.headers['set-cookie'] ? (Array.isArray(login.headers['set-cookie']) ? login.headers['set-cookie'] : [login.headers['set-cookie']]).map((c) => c.split(';')[0]).join('; ') : '';
    expect((await h.call(cookie, 'GET', '/me')).statusCode).toBe(200);

    expect((await h.call(root.cookie, 'POST', `${BASE}/${id}/reactivate`, { reason: 'sem necessidade' })).json().code).toBe('TENANT_NOT_SUSPENDED');

    const sus = await h.call(root.cookie, 'POST', `${BASE}/${id}/suspend`, { reason: 'contrato encerrado' });
    expect(sus.statusCode).toBe(200);
    expect(sus.json().data).toMatchObject({ status: 'suspensa', suspensionReason: 'contrato encerrado' });
    expect(sus.json().data.suspendedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    const row = await h.one<{ suspensa_por_id: string }>('SELECT suspensa_por_id FROM rh.contas WHERE id = $1', [id]);
    expect(Number(row.suspensa_por_id)).toBe(root.userId);
    expect(Number((await h.one<{ c: string }>('SELECT count(*) c FROM rh.sessoes WHERE conta_id = $1', [id])).c)).toBe(0);

    const dead = await h.call(cookie, 'GET', '/me');
    expect(dead.statusCode).toBe(401);
    const refused = await signIn(body.admin.email, body.temporaryPassword);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().code).toBe('ACCOUNT_SUSPENDED');

    expect((await h.call(root.cookie, 'POST', `${BASE}/${id}/suspend`, { reason: 'de novo' })).json().code).toBe('TENANT_ALREADY_SUSPENDED');

    const re = await h.call(root.cookie, 'POST', `${BASE}/${id}/reactivate`, { reason: 'pagou a fatura' });
    expect(re.statusCode).toBe(200);
    expect(re.json().data).toMatchObject({ status: 'ativa', suspendedAt: null, suspensionReason: null });
    expect((await signIn(body.admin.email, body.temporaryPassword)).statusCode).toBe(200);

    const audits = await h.client.query("SELECT motivo FROM rh.auditorias WHERE conta_id = $1 AND entidade = 'tenant' AND acao = 'alteracao' ORDER BY id", [id]);
    expect(audits.rows.map((r) => r.motivo)).toEqual(['contrato encerrado', 'pagou a fatura']);
  });

  it('exige motivo', async () => {
    const { body } = await createTenant();
    expect((await h.call(root.cookie, 'POST', `${BASE}/${body.tenant.id}/suspend`, {})).statusCode).toBe(400);
  });
});

describe('guarda', () => {
  it('super_admin sem 2FA recebe 403 MFA_REQUIRED; admin e rh recebem 403; anônimo 401', async () => {
    const noMfa = await h.loginAsSuperAdmin({ withMfa: false });
    const r = await h.call(noMfa.cookie, 'GET', BASE);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('MFA_REQUIRED');

    const { body } = await createTenant();
    const org: Org = { tenantId: body.tenant.id, companyId: 0, establishmentId: 0, otherEstablishmentId: 0, departmentId: 0, jobTitleId: 0, costCenterId: 0 };
    for (const role of ['admin', 'rh'] as const) {
      const s = await h.loginAs(org, role);
      expect((await h.call(s.cookie, 'GET', BASE)).statusCode).toBe(403);
      expect((await h.call(s.cookie, 'POST', BASE, createTenantBody({ n: 990 }))).statusCode).toBe(403);
    }
    expect((await h.app.inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
  });
});

describe('migration 0015', () => {
  it('trigger apaga as sessões da conta ao desativar; tentativas_login é só INSERT', async () => {
    const { body } = await createTenant();
    const id = body.tenant.id;
    await signIn(body.admin.email, body.temporaryPassword);
    expect(Number((await h.one<{ c: string }>('SELECT count(*) c FROM rh.sessoes WHERE conta_id = $1', [id])).c)).toBe(1);
    await h.client.query("UPDATE rh.contas SET ativo = false, suspensa_em = now(), motivo_suspensao = 'x' WHERE id = $1", [id]);
    expect(Number((await h.one<{ c: string }>('SELECT count(*) c FROM rh.sessoes WHERE conta_id = $1', [id])).c)).toBe(0);
    const upd = await h.one<{ atualizado_em: Date; criado_em: Date }>('SELECT atualizado_em, criado_em FROM rh.contas WHERE id = $1', [id]);
    expect(upd.atualizado_em.getTime()).toBeGreaterThanOrEqual(upd.criado_em.getTime());

    await h.client.query("INSERT INTO rh.tentativas_login (email_hash, etapa, eh_sucesso, motivo) VALUES ('\\x00', 'senha', false, 'credencial_invalida')");
    const state = async (sql: string) => {
      try {
        await h.client.query(sql);
      } catch (e) {
        return (e as { code?: string }).code;
      }
      return undefined;
    };
    expect(await state("UPDATE rh.tentativas_login SET etapa = 'totp'")).toBe('42501');
    expect(await state('DELETE FROM rh.tentativas_login')).toBe('42501');
    expect(await state('TRUNCATE rh.tentativas_login')).toBe('42501');
    expect(PASSWORD.length + TEST_MASTER_KEY.length).toBeGreaterThan(0);
  });
});
