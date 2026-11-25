/**
 * Empresas e estabelecimentos pelo super_admin: criação com chave da empresa, CNPJ e inscrição, registro
 * travado quando há colaborador, desativação, isolamento entre contas, auditoria e guarda.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeCpf, PortalHarness, type Org } from './support/portal';
import { findSensitiveKeys, invalidCnpj, validCnpj } from './fixtures/super-admin';

const h = new PortalHarness();
let root: { userId: number; cookie: string };
let org: Org;
let other: Org;
let n = 500;

beforeAll(async () => {
  await h.start();
  root = await h.loginAsSuperAdmin();
  org = await h.createOrg();
  other = await h.createOrg();
}, 240_000);
afterAll(async () => h.stop());

const base = (tenantId: number) => `/portal/super-admin/tenants/${tenantId}`;
const get = (url: string) => h.call(root.cookie, 'GET', url);
const post = (url: string, body: unknown) => h.call(root.cookie, 'POST', url, body);
const patch = (url: string, body: unknown) => h.call(root.cookie, 'PATCH', url, body);
const nextCnpj = () => validCnpj((n += 1));

const establishmentBody = (registration: string, over: Record<string, unknown> = {}) => ({
  name: `Unidade ${registration.slice(-6)}`,
  registrationType: 'CNPJ',
  registration,
  uf: 'MG',
  municipalityIbge: '3106200',
  ...over,
});

async function createCompany(tenantId = org.tenantId): Promise<{ id: number; cnpj: string }> {
  const res = await post(`${base(tenantId)}/companies`, { legalName: `Empresa ${n} Ltda`, cnpj: nextCnpj() });
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

async function createEstablishment(companyId: number, registration = nextCnpj()): Promise<{ id: number; registration: string }> {
  const res = await post(`${base(org.tenantId)}/companies/${companyId}/establishments`, establishmentBody(registration));
  expect(res.statusCode).toBe(201);
  return res.json().data;
}

const count = async (sql: string, params: unknown[]) => Number((await h.one<{ c: string }>(sql, params)).c);
const audits = async (entity: string, entityId: number) =>
  (
    await h.client.query(
      'SELECT acao, conta_id, usuario_id, dados_antes, dados_depois FROM rh.auditorias WHERE entidade = $1 AND entidade_id = $2 ORDER BY id',
      [entity, entityId],
    )
  ).rows;

describe('empresas', () => {
  it('cria com a chave da empresa, lista com os estabelecimentos e audita', async () => {
    const company = await createCompany();
    expect(company).toMatchObject({ isActive: true, establishments: [] });
    expect(await count('SELECT count(*) c FROM rh.chaves_empresa WHERE conta_id = $1 AND empresa_id = $2 AND eh_ativa', [org.tenantId, company.id])).toBe(1);

    const establishment = await createEstablishment(company.id);
    const list = await get(`${base(org.tenantId)}/companies`);
    expect(list.statusCode).toBe(200);
    const rows = list.json().data as { id: number; establishments: { id: number; companyId: number }[] }[];
    expect(rows.map((c) => c.id)).toEqual([org.companyId, company.id]);
    expect(rows[1]!.establishments).toEqual([expect.objectContaining({ id: establishment.id, companyId: company.id, isActive: true })]);
    expect(findSensitiveKeys(list.json())).toEqual([]);

    expect(await audits('company', company.id)).toEqual([
      expect.objectContaining({ acao: 'criacao', conta_id: String(org.tenantId), usuario_id: String(root.userId) }),
    ]);
  });

  it('400 CNPJ_INVALIDO, 409 CNPJ_DUPLICADO (sem sobra no banco) e 503 sem a chave mestra', async () => {
    const url = `${base(org.tenantId)}/companies`;
    const bad = await post(url, { legalName: 'Inválida Ltda', cnpj: invalidCnpj() });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('CNPJ_INVALIDO');

    const company = await createCompany();
    const before = await count('SELECT count(*) c FROM rh.empresas WHERE conta_id = $1', [org.tenantId]);
    const dup = await post(url, { legalName: 'Repetida Ltda', cnpj: company.cnpj });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CNPJ_DUPLICADO');
    expect(await count('SELECT count(*) c FROM rh.empresas WHERE conta_id = $1', [org.tenantId])).toBe(before);
    // o mesmo CNPJ vale em outra conta
    expect((await post(`${base(other.tenantId)}/companies`, { legalName: 'Outra Conta Ltda', cnpj: company.cnpj })).statusCode).toBe(201);

    const second = await createCompany();
    const clash = await patch(`${url}/${second.id}`, { cnpj: company.cnpj });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('CNPJ_DUPLICADO');

    const app = await h.newApp({ superAdmin: { masterKeyHex: null } });
    const s = await h.loginAsSuperAdmin({ app });
    const noKey = await h.call(s.cookie, 'POST', url, { legalName: 'Sem Chave Ltda', cnpj: nextCnpj() }, app);
    expect(noKey.statusCode).toBe(503);
    expect(noKey.json().code).toBe('MASTER_KEY_AUSENTE');
    await app.close();
  });

  it('altera, desativa, reativa; empresa inativa não recebe estabelecimento', async () => {
    const company = await createCompany();
    const url = `${base(org.tenantId)}/companies/${company.id}`;
    const off = await patch(url, { legalName: 'Novo Nome Ltda', isActive: false });
    expect(off.statusCode).toBe(200);
    expect(off.json().data).toMatchObject({ legalName: 'Novo Nome Ltda', isActive: false, cnpj: company.cnpj });

    const blocked = await post(`${url}/establishments`, establishmentBody(nextCnpj()));
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('EMPRESA_INATIVA');

    expect((await patch(url, { isActive: true })).json().data.isActive).toBe(true);
    // repetir o mesmo valor não gera evento
    expect((await patch(url, { isActive: true })).statusCode).toBe(200);
    expect((await audits('company', company.id)).map((a) => a.acao)).toEqual(['criacao', 'alteracao', 'alteracao']);
    expect((await patch(url, {})).statusCode).toBe(400);
  });

  it('409 REGISTRO_EM_USO ao mudar o CNPJ de empresa com colaborador; o resto continua editável', async () => {
    const company = await createCompany();
    const url = `${base(org.tenantId)}/companies/${company.id}`;
    expect((await patch(url, { cnpj: nextCnpj() })).statusCode).toBe(200);

    const establishment = await createEstablishment(company.id);
    await h.createEmployee(org, { establishmentId: establishment.id });
    const locked = await patch(url, { cnpj: nextCnpj() });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe('REGISTRO_EM_USO');
    expect((await patch(url, { legalName: 'Pode Mudar Ltda', isActive: false })).statusCode).toBe(200);
  });
});

describe('estabelecimentos', () => {
  it('409 INSCRICAO_DUPLICADA na mesma empresa e 400 CNPJ_INVALIDO', async () => {
    const company = await createCompany();
    const url = `${base(org.tenantId)}/companies/${company.id}/establishments`;
    const first = await createEstablishment(company.id);

    const dup = await post(url, establishmentBody(first.registration, { name: 'Repetida' }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('INSCRICAO_DUPLICADA');

    const second = await createEstablishment(company.id);
    const clash = await patch(`${base(org.tenantId)}/establishments/${second.id}`, { registration: first.registration });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe('INSCRICAO_DUPLICADA');

    const bad = await post(url, establishmentBody(invalidCnpj()));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe('CNPJ_INVALIDO');
  });

  it('com colaborador, tipo e inscrição travam; nome e situação não', async () => {
    const company = await createCompany();
    const establishment = await createEstablishment(company.id);
    const url = `${base(org.tenantId)}/establishments/${establishment.id}`;
    await h.createEmployee(org, { establishmentId: establishment.id });

    for (const body of [{ registration: nextCnpj() }, { registrationType: 'CAEPF' }]) {
      const res = await patch(url, body);
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('REGISTRO_EM_USO');
    }
    // reenviar o registro atual não é mudança
    const ok = await patch(url, { registration: establishment.registration, name: 'Renomeada', isActive: false });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ name: 'Renomeada', isActive: false, registration: establishment.registration });
    expect((await audits('establishment', establishment.id)).map((a) => a.acao)).toEqual(['criacao', 'alteracao']);
  });

  it('inscrição CPF não vai para a auditoria nem para o log', async () => {
    const company = await createCompany();
    const cpf = fakeCpf();
    const res = await post(
      `${base(org.tenantId)}/companies/${company.id}/establishments`,
      establishmentBody(cpf, { registrationType: 'CPF' }),
    );
    expect(res.statusCode).toBe(201);
    const id = res.json().data.id as number;
    const newCpf = fakeCpf();
    expect((await patch(`${base(org.tenantId)}/establishments/${id}`, { registration: newCpf })).statusCode).toBe(200);

    const rows = await audits('establishment', id);
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(cpf);
    expect(JSON.stringify(rows)).not.toContain(newCpf);
    h.expectLogsWithout(cpf, newCpf);
  });
});

describe('isolamento e guarda', () => {
  it('404 para id de outra conta e para conta inexistente', async () => {
    const calls = [
      await patch(`${base(org.tenantId)}/companies/${other.companyId}`, { legalName: 'Invasão' }),
      await post(`${base(org.tenantId)}/companies/${other.companyId}/establishments`, establishmentBody(nextCnpj())),
      await patch(`${base(org.tenantId)}/establishments/${other.establishmentId}`, { name: 'Invasão' }),
      await get(`${base(999_999)}/companies`),
      await post(`${base(999_999)}/companies`, { legalName: 'Fantasma Ltda', cnpj: nextCnpj() }),
    ];
    for (const res of calls) {
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('NOT_FOUND');
    }
    const untouched = await h.one<{ nome: string }>('SELECT nome FROM rh.estabelecimentos WHERE id = $1', [other.establishmentId]);
    expect(untouched.nome).toBe('Matriz');
  });

  it('403 para papel de cliente e 401 sem sessão em todas as rotas', async () => {
    const routes = [
      ['GET', `${base(org.tenantId)}/companies`],
      ['POST', `${base(org.tenantId)}/companies`],
      ['PATCH', `${base(org.tenantId)}/companies/${org.companyId}`],
      ['POST', `${base(org.tenantId)}/companies/${org.companyId}/establishments`],
      ['PATCH', `${base(org.tenantId)}/establishments/${org.establishmentId}`],
    ] as const;
    const clients = [await h.loginAs(org, 'admin'), await h.loginAs(org, 'rh')];
    for (const [method, url] of routes) {
      for (const client of clients) {
        expect((await h.call(client.cookie, method, url)).statusCode, `${method} ${url}`).toBe(403);
      }
      expect((await h.call('', method, url)).statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
