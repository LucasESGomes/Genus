/** Setores, cargos e centros de custo (G1, RF02): conta, escopo, papel e nome repetido. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortalHarness, type Org } from './support/portal';

const h = new PortalHarness();
let org: Org;
let other: Org;

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  other = await h.createOrg();
}, 240_000);
afterAll(async () => h.stop());

describe('setores', () => {
  it('rh cria, lista e altera; nome repetido no estabelecimento = 409 NOME_DUPLICADO', async () => {
    const { cookie } = await h.loginAs(org, 'rh');
    const created = await h.call(cookie, 'POST', '/portal/departments', { establishmentId: org.establishmentId, name: 'Oficina', maxSimultaneousVacations: 2 });
    expect(created.statusCode).toBe(201);
    const dep = created.json().data;
    expect(dep).toMatchObject({ establishmentId: org.establishmentId, name: 'Oficina', maxSimultaneousVacations: 2 });

    const list = await h.call(cookie, 'GET', `/portal/departments?establishmentId=${org.establishmentId}`);
    expect(list.statusCode).toBe(200);
    expect((list.json().data as { name: string }[]).map((d) => d.name)).toEqual(['Colheita', 'Oficina']);

    const dup = await h.call(cookie, 'POST', '/portal/departments', { establishmentId: org.establishmentId, name: 'Oficina' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('NOME_DUPLICADO');

    const patched = await h.call(cookie, 'PATCH', `/portal/departments/${dep.id}`, { name: 'Oficina Mecânica' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.name).toBe('Oficina Mecânica');

    const audit = await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.auditorias WHERE entidade = 'setores' AND entidade_id = $1", [dep.id]);
    expect(Number(audit.n)).toBe(2);
  });

  it('admin também escreve; contador só lê', async () => {
    const admin = await h.loginAs(org, 'admin');
    expect((await h.call(admin.cookie, 'POST', '/portal/departments', { establishmentId: org.establishmentId, name: 'Escritório' })).statusCode).toBe(201);
    const contador = await h.loginAs(org, 'contador');
    expect((await h.call(contador.cookie, 'GET', `/portal/departments?establishmentId=${org.establishmentId}`)).statusCode).toBe(200);
    expect((await h.call(contador.cookie, 'POST', '/portal/departments', { establishmentId: org.establishmentId, name: 'Outro' })).statusCode).toBe(403);
  });

  it('outra conta e fora do escopo: 404', async () => {
    const { cookie } = await h.loginAs(other, 'rh');
    expect((await h.call(cookie, 'GET', `/portal/departments?establishmentId=${org.establishmentId}`)).statusCode).toBe(404);
    expect((await h.call(cookie, 'PATCH', `/portal/departments/${org.departmentId}`, { name: 'Invasão' })).statusCode).toBe(404);

    const scoped = await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] });
    expect((await h.call(scoped.cookie, 'GET', `/portal/departments?establishmentId=${org.establishmentId}`)).statusCode).toBe(404);
    expect((await h.call(scoped.cookie, 'PATCH', `/portal/departments/${org.departmentId}`, { name: 'Fora' })).statusCode).toBe(404);
  });
});

describe('cargos e centros de custo (da empresa)', () => {
  it('lista pela empresa do estabelecimento (matriz e filial veem os mesmos)', async () => {
    const { cookie } = await h.loginAs(org, 'rh');
    const created = await h.call(cookie, 'POST', '/portal/job-titles', { establishmentId: org.otherEstablishmentId, name: 'Tratorista', cbo: '641015' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ companyId: org.companyId, name: 'Tratorista', cbo: '641015' });

    const fromMatriz = await h.call(cookie, 'GET', `/portal/job-titles?establishmentId=${org.establishmentId}`);
    expect((fromMatriz.json().data as { name: string }[]).map((j) => j.name)).toEqual(['Operador Rural', 'Tratorista']);

    const dup = await h.call(cookie, 'POST', '/portal/job-titles', { establishmentId: org.establishmentId, name: 'Tratorista' });
    expect(dup.json().code).toBe('NOME_DUPLICADO');
    expect((await h.call(cookie, 'POST', '/portal/job-titles', { establishmentId: org.establishmentId, name: 'X1', cbo: '12' })).statusCode).toBe(400);
  });

  it('centro de custo: código repetido = 409 CODIGO_DUPLICADO; outra conta = 404', async () => {
    const { cookie } = await h.loginAs(org, 'rh');
    const created = await h.call(cookie, 'POST', '/portal/cost-centers', { establishmentId: org.establishmentId, code: 'CC2', name: 'Oficina' });
    expect(created.statusCode).toBe(201);
    const dup = await h.call(cookie, 'POST', '/portal/cost-centers', { establishmentId: org.establishmentId, code: 'CC2', name: 'Outro' });
    expect(dup.json().code).toBe('CODIGO_DUPLICADO');
    const patched = await h.call(cookie, 'PATCH', `/portal/cost-centers/${created.json().data.id}`, { name: 'Oficina Central' });
    expect(patched.json().data).toMatchObject({ code: 'CC2', name: 'Oficina Central' });

    const intruder = await h.loginAs(other, 'rh');
    expect((await h.call(intruder.cookie, 'PATCH', `/portal/cost-centers/${org.costCenterId}`, { name: 'xx' })).statusCode).toBe(404);
    expect((await h.call(intruder.cookie, 'PATCH', `/portal/job-titles/${org.jobTitleId}`, { name: 'xx' })).statusCode).toBe(404);
  });

  it('colaborador: 403; sem sessão: 401', async () => {
    const e = await h.createEmployee(org);
    const { cookie } = await h.loginAs(org, 'colaborador', { employeeId: e.id });
    expect((await h.call(cookie, 'GET', `/portal/job-titles?establishmentId=${org.establishmentId}`)).statusCode).toBe(403);
    expect((await h.call('', 'GET', `/portal/cost-centers?establishmentId=${org.establishmentId}`)).statusCode).toBe(401);
  });
});
