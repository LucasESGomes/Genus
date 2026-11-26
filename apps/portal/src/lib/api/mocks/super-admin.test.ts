import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateTenantInput } from '../super-admin-contracts';
import { MOCK_TOTP_CODE } from './index';
import { mockSuperAdminApi as api, resetMockSuperAdmin } from './super-admin';

beforeEach(() => resetMockSuperAdmin());

const input = (over: Partial<CreateTenantInput> = {}): CreateTenantInput => ({
  name: 'Fazenda Nova Aurora',
  company: { legalName: 'Fazenda Nova Aurora Ltda', cnpj: '11.222.333/0001-81' },
  establishment: { name: 'Sede', registrationType: 'CNPJ', registration: '11222333000181', uf: 'GO', municipalityIbge: '5218805' },
  admin: { name: 'Teresa Campos', email: 'teresa@exemplo.test', cpf: '52998224725' },
  ...over,
});

describe('mock do super admin: empresas', () => {
  it('lista 4 empresas, uma suspensa, e filtra por situação e busca sem acento', async () => {
    const all = await api.tenants.list({});
    expect(all.data).toHaveLength(4);
    expect(all.meta).toMatchObject({ page: 1, total: 4 });
    expect(all.data.filter((t) => t.status === 'suspensa').map((t) => t.name)).toEqual(['Cooperativa Vale Verde']);
    expect((await api.tenants.list({ status: 'suspensa' })).data).toHaveLength(1);
    expect((await api.tenants.list({ q: 'AGROPECUARIA' })).data.map((t) => t.id)).toEqual(['1']);
  });
  it('cria empresa: aparece na lista e o token do convite vem só na resposta', async () => {
    const created = await api.tenants.create(input());
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    expect(created.invite).toMatchObject({ email: 'teresa@exemplo.test', role: 'admin', status: 'pendente' });
    expect(created.tenant.status).toBe('ativa');
    expect(JSON.stringify(await api.tenants.get(created.tenant.id))).not.toContain(created.token);
    expect((await api.tenants.list({})).data.some((t) => t.id === created.tenant.id)).toBe(true);
  });
  it('recusa CNPJ inválido (400) e e-mail em uso (409)', async () => {
    await expect(api.tenants.create(input({ company: { legalName: 'X Ltda', cnpj: '11222333000182' } }))).rejects.toMatchObject({ status: 400, code: 'CNPJ_INVALIDO' });
    await expect(api.tenants.create(input({ admin: { name: 'Outra', email: 'LUCIA@exemplo.test', cpf: '52998224725' } }))).rejects.toMatchObject({ status: 409, code: 'EMAIL_IN_USE' });
  });
  it('suspender guarda o motivo, derruba as sessões e audita; repetir dá 409', async () => {
    const t = await api.tenants.suspend('1', ' Pedido do contratante ');
    expect(t).toMatchObject({ status: 'suspensa', suspensionReason: 'Pedido do contratante' });
    expect(t.suspendedAt).not.toBeNull();
    await expect(api.tenants.suspend('1', 'de novo')).rejects.toMatchObject({ status: 409, code: 'TENANT_ALREADY_SUSPENDED' });
    expect((await api.access.sessions({ tenantId: '1', active: true })).data).toHaveLength(0);
    const first = (await api.audit.list({})).data[0];
    expect(first).toMatchObject({ entity: 'tenant', action: 'alteracao', entityId: '1', reason: 'Pedido do contratante' });
  });
  it('reativar limpa o motivo; em conta ativa dá 409', async () => {
    const t = await api.tenants.reactivate('4', 'Pagamento regularizado');
    expect(t).toMatchObject({ status: 'ativa', suspendedAt: null, suspensionReason: null });
    await expect(api.tenants.reactivate('4', 'de novo')).rejects.toMatchObject({ status: 409, code: 'TENANT_NOT_SUSPENDED' });
  });
  it('renomear muda a próxima leitura; id desconhecido dá 404', async () => {
    await api.tenants.update('2', { name: '  Usina Boa Vista Energia ' });
    expect((await api.tenants.get('2')).name).toBe('Usina Boa Vista Energia');
    await expect(api.tenants.get('999')).rejects.toMatchObject({ status: 404 });
  });
});

describe('mock do super admin: leituras', () => {
  it('auditoria pagina por cursor e o detalhe traz antes e depois', async () => {
    const p1 = await api.audit.list({ limit: 5 });
    expect(p1.data).toHaveLength(5);
    expect(p1.meta.nextCursor).toBe(p1.data[4]?.id);
    const p2 = await api.audit.list({ limit: 5, cursor: p1.meta.nextCursor ?? undefined });
    expect(p2.data[0]?.id).not.toBe(p1.data[0]?.id);
    const detail = await api.audit.get('11');
    expect(detail.before).toEqual({ ativo: true, motivoSuspensao: null });
    expect('before' in p1.data[0]!).toBe(false);
  });
  it('tentativas de login sinalizam o IP 203.0.113.45 e revogar sessão audita', async () => {
    const flagged = await api.access.flaggedIps('24h');
    expect(flagged[0]).toMatchObject({ ipAddress: '203.0.113.45', flagged: true });
    expect((await api.access.loginAttempts({ ip: '203.0.113.45', success: false })).data.length).toBeGreaterThanOrEqual(9);
    expect(await api.access.revokeSession('2', 'Teste')).toEqual({ revoked: 1 });
    expect(await api.access.revokeSession('2', 'Teste')).toEqual({ revoked: 0 });
  });
  it('reconhecimento tem os quatro campos nulos e a série respeita o balde', async () => {
    const s = await api.recognition.summary({ window: '7d' });
    expect(s).toMatchObject({ notRecognized: null, livenessFailed: null, latencyP50Ms: null, latencyP95Ms: null });
    expect(await api.recognition.series({ window: '7d', bucket: 'day' })).toHaveLength(7);
    expect((await api.recognition.devices({ tenantId: '3' })).every((d) => d.tenantId === '3')).toBe(true);
  });
  it('visão geral, crescimento e saúde', async () => {
    const o = await api.stats.overview('30d');
    expect(o.tenants).toEqual({ total: 4, active: 3, suspended: 1 });
    expect(o.punchesPerDay).toHaveLength(30);
    expect(await api.stats.growth(12)).toHaveLength(12);
    expect((await api.stats.tenant('1', '7d')).tenantId).toBe('1');
    const h = await api.health.get();
    expect(h.checks.filter((c) => c.status === 'degraded')).toHaveLength(1);
  });
  it('nenhum dado devolvido parece CPF', async () => {
    const dump = JSON.stringify([await api.tenants.list({}), await api.tenants.get('1'), await api.audit.list({}), await api.access.sessions({}), await api.recognition.devices({})]);
    expect(dump).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(dump).not.toMatch(/\b\d{11}\b/);
  });
});

describe('mock do super admin: 2FA', () => {
  it('enable devolve o endereço otpauth com a chave e códigos de recuperação', async () => {
    const r = await api.auth2fa.enable('qualquer-senha');
    expect(r.totpURI).toMatch(/^otpauth:\/\/totp\/.+\?secret=[A-Z2-7]+&/);
    expect(r.backupCodes.length).toBeGreaterThanOrEqual(8);
    await expect(api.auth2fa.enable('')).rejects.toMatchObject({ status: 400 });
  });
  it('verify aceita 123456 e recusa o resto', async () => {
    await expect(api.auth2fa.verify(MOCK_TOTP_CODE)).resolves.toBeUndefined();
    await expect(api.auth2fa.verify('000000')).rejects.toMatchObject({ status: 401 });
  });
});
