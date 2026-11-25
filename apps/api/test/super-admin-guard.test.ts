/**
 * Guarda do painel do super_admin (docs/prompts/super-admin-contrato.md): TODA rota de
 * /portal/super-admin/* × todos os papéis. Cliente = 403, anônimo = 401, super_admin sem 2FA =
 * 403 MFA_REQUIRED, super_admin com 2FA passa. E nenhuma resposta do painel traz chave sensível.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../src/plugins/request-context';
import { findSensitiveKeys } from './fixtures/super-admin';
import { PortalHarness, type Org } from './support/portal';

const h = new PortalHarness({ gestorEnabled: true });

type Method = 'GET' | 'POST' | 'PATCH';
/** `:t` = conta de teste, `:s` = sessão, `:u` = usuário, `:a` = linha de auditoria. */
const ROUTES: [Method, string, unknown?][] = [
  ['GET', '/portal/super-admin/tenants'],
  ['POST', '/portal/super-admin/tenants', {}],
  ['GET', '/portal/super-admin/tenants/:t'],
  ['PATCH', '/portal/super-admin/tenants/:t', { name: 'Conta Renomeada' }],
  ['POST', '/portal/super-admin/tenants/:t/suspend', { reason: 'teste de guarda' }],
  ['POST', '/portal/super-admin/tenants/:t/reactivate', { reason: 'teste de guarda' }],
  ['GET', '/portal/super-admin/audit-logs'],
  ['GET', '/portal/super-admin/audit-logs/:a'],
  ['GET', '/portal/super-admin/access/sessions'],
  ['GET', '/portal/super-admin/access/login-attempts'],
  ['GET', '/portal/super-admin/access/flagged-ips'],
  ['POST', '/portal/super-admin/access/sessions/:s/revoke', { reason: 'teste de guarda' }],
  ['POST', '/portal/super-admin/access/users/:u/revoke-sessions', { reason: 'teste de guarda' }],
  ['GET', '/portal/super-admin/recognition/summary'],
  ['GET', '/portal/super-admin/recognition/series'],
  ['GET', '/portal/super-admin/recognition/devices'],
  ['GET', '/portal/super-admin/stats/overview'],
  ['GET', '/portal/super-admin/stats/tenants/:t'],
  ['GET', '/portal/super-admin/stats/growth'],
  ['GET', '/portal/super-admin/system-health'],
];

const CLIENT_ROLES: Role[] = ['admin', 'rh', 'gestor', 'contador', 'colaborador'];

let org: Org;
let ids: { t: number; s: number; u: number; a: number };
const cookies = new Map<string, string>();

const url = (path: string) => path.replace(':t', String(ids.t)).replace(':s', String(ids.s)).replace(':u', String(ids.u)).replace(':a', String(ids.a));

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  for (const role of CLIENT_ROLES) {
    const employeeId = role === 'colaborador' ? (await h.createEmployee(org)).id : null;
    const s = await h.loginAs(org, role, { employeeId });
    cookies.set(role, s.cookie);
  }
  cookies.set('noMfa', (await h.loginAsSuperAdmin({ withMfa: false })).cookie);
  const root = await h.loginAsSuperAdmin();
  cookies.set('super_admin', root.cookie);

  // Alvos que existem, para a guarda (e não o 404) responder.
  const victim = await h.loginAs(org, 'rh');
  const sessionId = Number((await h.one<{ id: string }>('SELECT id FROM rh.sessoes WHERE usuario_id = $1 LIMIT 1', [victim.userId])).id);
  const auditId = await h.id(
    "INSERT INTO rh.auditorias (conta_id, usuario_id, entidade, entidade_id, acao) VALUES ($1, $2, 'tenant', $1, 'alteracao') RETURNING id",
    [org.tenantId, root.userId],
  );
  ids = { t: org.tenantId, s: sessionId, u: victim.userId, a: auditId };
}, 180_000);

afterAll(async () => {
  await h.stop();
});

describe('guarda do /portal/super-admin', () => {
  it.each(ROUTES)('%s %s: anônimo recebe 401', async (method, path, body) => {
    const res = await h.app.inject({ method, url: url(path), ...(body !== undefined ? { payload: body as object } : {}) });
    expect(res.statusCode).toBe(401);
  });

  it.each(ROUTES)('%s %s: nenhum papel de cliente passa (403)', async (method, path, body) => {
    for (const role of CLIENT_ROLES) {
      const res = await h.call(cookies.get(role)!, method, url(path), body);
      expect(res.statusCode, `${role} em ${method} ${path}`).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }
  });

  it.each(ROUTES)('%s %s: super_admin sem 2FA recebe 403 MFA_REQUIRED', async (method, path, body) => {
    const res = await h.call(cookies.get('noMfa')!, method, url(path), body);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MFA_REQUIRED');
  });

  it.each(ROUTES.filter(([m]) => m === 'GET'))('%s %s: super_admin com 2FA passa e a resposta não tem chave sensível', async (method, path) => {
    const res = await h.call(cookies.get('super_admin')!, method, url(path));
    expect(res.statusCode, res.body).toBe(200);
    expect(findSensitiveKeys(res.json())).toEqual([]);
  });

  it('a guarda vale antes da validação: corpo inválido de cliente é 403, não 400', async () => {
    const res = await h.call(cookies.get('rh')!, 'POST', '/portal/super-admin/tenants', { lixo: true });
    expect(res.statusCode).toBe(403);
  });

  it('o super_admin continua fora dos módulos de RH', async () => {
    const res = await h.call(cookies.get('super_admin')!, 'GET', '/portal/employees');
    expect(res.statusCode).toBe(403);
  });
});
