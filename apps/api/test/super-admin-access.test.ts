/**
 * Super admin: acessos (sessões, tentativas de login, IPs sinalizados, revogação). Postgres real,
 * login de verdade. As tentativas de login são gravadas pelo hook de `modules/auth/routes.ts`; aqui o
 * app de login é montado só com `authRoutes` + `loginAttempts` (a fiação no app.ts é do coordenador).
 */
import { createHmac } from 'node:crypto';
import { Writable } from 'node:stream';
import { createLogger, SystemClock } from '@genus/shared';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAuth } from '../src/modules/auth/auth';
import { authRoutes } from '../src/modules/auth/routes';
import { deriveEmailHashKey, hashLoginEmail } from '../src/modules/super-admin/access-logs/email-hash';
import { expectNoForbiddenKeys } from './support/json-keys';
import { BASE_URL, cookiesOf, PASSWORD, PortalHarness, type Org } from './support/portal';

const h = new PortalHarness({ gestorEnabled: true });
const BASE = '/portal/super-admin/access';
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';
const KEY = deriveEmailHashKey(SECRET);
const ORIGIN = { origin: BASE_URL };

let orgA: Org;
let orgB: Org;
let sa: { userId: number; cookie: string };
let loginApp: FastifyInstance;
const loginLogs: string[] = [];
let seq = 0;

// ---- TOTP (RFC 6238), mesmo helper de auth.test.ts
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of input.replace(/=+$/, '').toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secretBase32: string, at: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const signIn = (email: string, password = PASSWORD, app = loginApp) => app.inject({ method: 'POST', url: '/auth/sign-in/email', headers: ORIGIN, payload: { email, password } });

async function newUser(org: Org | null, role: 'admin' | 'rh' | 'super_admin' = 'admin') {
  seq += 1;
  return h.users.createUser({ tenantId: org?.tenantId ?? null, email: `acesso${seq}@acesso.teste.dev`, name: `Usuário ${seq}`, role, password: PASSWORD });
}

interface AttemptRow {
  conta_id: string | null;
  usuario_id: string | null;
  email_hash: Buffer;
  endereco_ip: string | null;
  agente_usuario: string | null;
  etapa: string;
  eh_sucesso: boolean;
  motivo: string | null;
}

/** A gravação é fire-and-forget: espera a linha aparecer. */
async function attemptsOf(where: string, params: unknown[], expected: number): Promise<AttemptRow[]> {
  let rows: AttemptRow[] = [];
  await vi.waitFor(async () => {
    rows = (await h.client.query<AttemptRow>(`SELECT * FROM rh.tentativas_login WHERE ${where} ORDER BY id`, params)).rows;
    expect(rows).toHaveLength(expected);
  }, { timeout: 5000, interval: 50 });
  return rows;
}

beforeAll(async () => {
  await h.start();
  orgA = await h.createOrg();
  orgB = await h.createOrg();
  sa = await h.loginAsSuperAdmin();
  const logger = createLogger({
    level: 'debug',
    service: 'test',
    destination: new Writable({
      write: (chunk: Buffer, _enc, cb) => {
        loginLogs.push(chunk.toString());
        cb();
      },
    }),
  });
  const auth = createAuth(h.handle.db, { secret: SECRET, baseURL: BASE_URL, trustedOrigins: [], secureCookies: false, rateLimit: false }, logger);
  loginApp = Fastify({ loggerInstance: logger as FastifyBaseLogger });
  await loginApp.register(authRoutes, { auth, baseURL: BASE_URL, loginAttempts: { db: h.handle.db, clock: new SystemClock(), emailHashKey: KEY } });
}, 240_000);
afterAll(async () => {
  await loginApp?.close();
  await h.stop();
});

describe('guarda', () => {
  it('papéis de cliente: 403 nas leituras e nas revogações', async () => {
    const employee = await h.createEmployee(orgA);
    const roles = [
      await h.loginAs(orgA, 'admin'),
      await h.loginAs(orgA, 'rh'),
      await h.loginAs(orgA, 'gestor'),
      await h.loginAs(orgA, 'contador'),
      await h.loginAs(orgA, 'colaborador', { employeeId: employee.id }),
    ];
    for (const s of roles) {
      for (const url of [`${BASE}/sessions`, `${BASE}/login-attempts`, `${BASE}/flagged-ips`]) {
        const res = await h.call(s.cookie, 'GET', url);
        expect(res.statusCode, url).toBe(403);
      }
      expect((await h.call(s.cookie, 'POST', `${BASE}/sessions/1/revoke`, { reason: 'tentativa indevida' })).statusCode).toBe(403);
      expect((await h.call(s.cookie, 'POST', `${BASE}/users/${s.userId}/revoke-sessions`, { reason: 'tentativa indevida' })).statusCode).toBe(403);
    }
  });

  it('sem sessão: 401; super_admin sem 2FA: 403 MFA_REQUIRED', async () => {
    expect((await h.app.inject({ method: 'GET', url: `${BASE}/sessions` })).statusCode).toBe(401);
    const noMfa = await h.loginAsSuperAdmin({ withMfa: false });
    const res = await h.call(noMfa.cookie, 'GET', `${BASE}/sessions`);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('MFA_REQUIRED');
  });
});

describe('registro das tentativas de login', () => {
  it('senha errada, senha certa e e-mail desconhecido', async () => {
    const user = await newUser(orgA);
    const ua = 'AgenteTeste/1.0 ' + 'x'.repeat(400);

    const wrong = await loginApp.inject({ method: 'POST', url: '/auth/sign-in/email', headers: { ...ORIGIN, 'user-agent': ua }, payload: { email: user.email.toUpperCase(), password: 'senha-errada-de-teste-1' } });
    expect(wrong.statusCode).toBe(401);
    const [bad] = await attemptsOf('usuario_id = $1', [user.id], 1);
    expect(bad).toMatchObject({ etapa: 'senha', eh_sucesso: false, motivo: 'credencial_invalida', conta_id: String(orgA.tenantId) });
    expect(bad!.agente_usuario).toHaveLength(300);
    expect(bad!.endereco_ip).toBeTruthy();
    expect(bad!.email_hash.equals(hashLoginEmail(KEY, user.email))).toBe(true);

    expect((await signIn(user.email)).statusCode).toBe(200);
    const rows = await attemptsOf('usuario_id = $1', [user.id], 2);
    expect(rows[1]).toMatchObject({ etapa: 'senha', eh_sucesso: true, motivo: null });

    const ghost = `fantasma${seq}@acesso.teste.dev`;
    expect((await signIn(ghost)).statusCode).toBeGreaterThanOrEqual(400);
    const [unknown] = await attemptsOf('email_hash = $1', [hashLoginEmail(KEY, ghost)], 1);
    expect(unknown).toMatchObject({ usuario_id: null, conta_id: null, eh_sucesso: false, motivo: 'credencial_invalida' });
  });

  it('usuário inativo e conta suspensa', async () => {
    const inactive = await newUser(orgA);
    await h.client.query('UPDATE rh.usuarios SET ativo = false WHERE id = $1', [inactive.id]);
    expect((await signIn(inactive.email)).statusCode).toBe(401);
    const [a] = await attemptsOf('usuario_id = $1', [inactive.id], 1);
    expect(a).toMatchObject({ eh_sucesso: false, motivo: 'usuario_inativo' });

    const suspendedOrg = await h.createOrg();
    const member = await newUser(suspendedOrg);
    await h.client.query("UPDATE rh.contas SET ativo = false, suspensa_em = now(), motivo_suspensao = 'teste de suspensão' WHERE id = $1", [suspendedOrg.tenantId]);
    const res = await signIn(member.email);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ACCOUNT_SUSPENDED');
    const [b] = await attemptsOf('usuario_id = $1', [member.id], 1);
    expect(b).toMatchObject({ eh_sucesso: false, motivo: 'conta_suspensa', conta_id: String(suspendedOrg.tenantId) });
  });

  it('TOTP: código errado e certo são registrados com o usuário do desafio; e-mail nunca em claro', async () => {
    const user = await newUser(null, 'super_admin');
    const first = await signIn(user.email);
    expect(first.statusCode).toBe(200);
    const cookie0 = cookiesOf(first);
    const enable = await loginApp.inject({ method: 'POST', url: '/auth/two-factor/enable', headers: { ...ORIGIN, cookie: cookie0 }, payload: { password: PASSWORD } });
    expect(enable.statusCode).toBe(200);
    const secret = new URL(enable.json<{ totpURI: string }>().totpURI).searchParams.get('secret')!;
    const activated = await loginApp.inject({ method: 'POST', url: '/auth/two-factor/verify-totp', headers: { ...ORIGIN, cookie: cookie0 }, payload: { code: totp(secret) } });
    expect(activated.statusCode).toBe(200);
    await loginApp.inject({ method: 'POST', url: '/auth/sign-out', headers: { ...ORIGIN, cookie: cookiesOf(activated) || cookie0 } });

    const step1 = await signIn(user.email);
    expect(step1.json()).toMatchObject({ twoFactorRedirect: true });
    const pending = cookiesOf(step1);
    const wrong = String((Number(totp(secret)) + 1) % 1_000_000).padStart(6, '0');
    const bad = await loginApp.inject({ method: 'POST', url: '/auth/two-factor/verify-totp', headers: { ...ORIGIN, cookie: pending }, payload: { code: wrong } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    const good = await loginApp.inject({ method: 'POST', url: '/auth/two-factor/verify-totp', headers: { ...ORIGIN, cookie: pending }, payload: { code: totp(secret, Date.now() + 30_000) } });
    expect(good.statusCode).toBe(200);

    const rows = await attemptsOf("usuario_id = $1 AND etapa = 'totp'", [user.id], 2);
    expect(rows[0]).toMatchObject({ eh_sucesso: false, motivo: 'totp_invalido', conta_id: null });
    expect(rows[1]).toMatchObject({ eh_sucesso: true, motivo: null });
    // o e-mail do usuário do desafio entra no hash, como no passo da senha
    expect(rows[0]!.email_hash.equals(hashLoginEmail(KEY, user.email))).toBe(true);
  });

  it('TOTP sem desafio (sem cookie) e ativação do 2FA não são tentativas de login: nada é gravado', async () => {
    const count = async () => Number((await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.tentativas_login WHERE etapa = 'totp'")).n);
    const before = await count();
    const res = await loginApp.inject({ method: 'POST', url: '/auth/two-factor/verify-totp', headers: ORIGIN, payload: { code: '123456' } });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    await new Promise((r) => setTimeout(r, 200));
    expect(await count()).toBe(before);
  });

  it('sem `loginAttempts` o plugin não grava nada', async () => {
    const plain = Fastify();
    const auth = createAuth(h.handle.db, { secret: SECRET, baseURL: BASE_URL, trustedOrigins: [], secureCookies: false, rateLimit: false }, createLogger({ level: 'silent', service: 'test' }));
    await plain.register(authRoutes, { auth, baseURL: BASE_URL });
    const before = Number((await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.tentativas_login')).n);
    const user = await newUser(orgA);
    expect((await signIn(user.email, PASSWORD, plain)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(Number((await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.tentativas_login')).n)).toBe(before);
    await plain.close();
  });

  it('nenhum e-mail em claro na tabela nem nos logs', async () => {
    const user = await newUser(orgB);
    await signIn(user.email, 'senha-errada-de-teste-2');
    await attemptsOf('usuario_id = $1', [user.id], 1);
    const dump = (await h.client.query("SELECT t::text AS linha FROM rh.tentativas_login t WHERE usuario_id = $1", [user.id])).rows.map((r) => r.linha).join('\n');
    expect(dump).not.toContain(user.email);
    expect(dump).not.toContain('@');
    const logs = loginLogs.join('\n');
    expect(logs).not.toContain(user.email);
    expect(logs).not.toContain(PASSWORD);
  });
});

describe('GET /access/login-attempts', () => {
  const IP = '198.51.100.77';

  it('filtra por IP, sucesso e conta; pagina por cursor; audita; sem e-mail nem hash', async () => {
    const hash = hashLoginEmail(KEY, 'lista@acesso.teste.dev');
    for (let i = 0; i < 5; i += 1) {
      await h.client.query(
        `INSERT INTO rh.tentativas_login (conta_id, email_hash, endereco_ip, etapa, eh_sucesso, motivo) VALUES ($1, $2, $3, 'senha', $4, $5)`,
        [i === 0 ? orgB.tenantId : null, hash, IP, i === 4, i === 4 ? null : 'credencial_invalida'],
      );
    }
    const all = (await h.call(sa.cookie, 'GET', `${BASE}/login-attempts?ip=${IP}&limit=3`)).json();
    expect(all.data).toHaveLength(3);
    expect(all.meta.limit).toBe(3);
    expect(all.meta.nextCursor).toBe(all.data[2].id);
    const next = (await h.call(sa.cookie, 'GET', `${BASE}/login-attempts?ip=${IP}&limit=3&cursor=${all.meta.nextCursor}`)).json();
    expect(next.data).toHaveLength(2);
    expect(next.meta.nextCursor).toBeNull();
    expect([...all.data, ...next.data].map((r: { id: number }) => r.id)).toEqual([...all.data, ...next.data].map((r: { id: number }) => r.id).sort((a, b) => b - a));
    expectNoForbiddenKeys(all);
    expect(JSON.stringify(all)).not.toContain('acesso.teste.dev');

    const ok = (await h.call(sa.cookie, 'GET', `${BASE}/login-attempts?ip=${IP}&success=true`)).json();
    expect(ok.data).toHaveLength(1);
    expect(ok.data[0]).toMatchObject({ success: true, failureReason: null, step: 'senha' });
    const failed = (await h.call(sa.cookie, 'GET', `${BASE}/login-attempts?ip=${IP}&success=false`)).json();
    expect(failed.data).toHaveLength(4);
    const byTenant = (await h.call(sa.cookie, 'GET', `${BASE}/login-attempts?ip=${IP}&tenantId=${orgB.tenantId}`)).json();
    expect(byTenant.data).toHaveLength(1);

    const audit = await h.one<{ n: string }>(
      `SELECT count(*) AS n FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'access_log' AND conta_id = $1 AND usuario_id = $2 AND dados_depois->>'view' = 'login_attempts'`,
      [orgB.tenantId, sa.userId],
    );
    expect(Number(audit.n)).toBe(1);
  });

  it('período maior que 90 dias: 400', async () => {
    const res = await h.call(sa.cookie, 'GET', `${BASE}/login-attempts?from=${encodeURIComponent('2026-01-01T00:00:00Z')}&to=${encodeURIComponent('2026-06-01T00:00:00Z')}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /access/flagged-ips', () => {
  async function insertAttempts(ip: string, n: number, minutesAgo: number, opts: { success?: boolean; distinct?: boolean } = {}) {
    for (let i = 0; i < n; i += 1) {
      const hash = hashLoginEmail(KEY, opts.distinct ? `${ip}-${i}@flag.teste.dev` : `${ip}@flag.teste.dev`);
      await h.client.query(
        `INSERT INTO rh.tentativas_login (email_hash, endereco_ip, etapa, eh_sucesso, motivo, criado_em)
         VALUES ($1, $2, 'senha', $3, $4, $5)`,
        [hash, ip, opts.success ?? false, opts.success ? null : 'credencial_invalida', new Date(Date.now() - minutesAgo * 60_000)],
      );
    }
  }

  it('sinaliza excesso de falhas e de contas, ordena e ignora IP só com sucesso', async () => {
    await insertAttempts('198.51.100.1', 10, 5); // 10 falhas nos últimos 15 min
    await insertAttempts('198.51.100.2', 3, 5, { distinct: true }); // 3 e-mails na última hora
    await insertAttempts('198.51.100.3', 2, 5); // pouco
    await insertAttempts('198.51.100.4', 4, 5, { success: true }); // sem falha
    await insertAttempts('198.51.100.5', 10, 180); // falhas antigas (3 h)

    const res = await h.call(sa.cookie, 'GET', `${BASE}/flagged-ips?window=24h`);
    expect(res.statusCode).toBe(200);
    const ours = (res.json().data as { ipAddress: string; failures: number; successes: number; distinctAccounts: number; flagged: boolean; reasons: string[]; firstSeenAt: string; lastSeenAt: string }[]).filter((r) =>
      r.ipAddress.startsWith('198.51.100.') && r.ipAddress < '198.51.100.7',
    );
    expect(ours.map((r) => r.ipAddress)).toEqual(['198.51.100.1', '198.51.100.2', '198.51.100.5', '198.51.100.3']);
    expect(ours[0]).toMatchObject({ failures: 10, successes: 0, distinctAccounts: 1, flagged: true, reasons: ['muitas_falhas'] });
    expect(ours[1]).toMatchObject({ failures: 3, distinctAccounts: 3, flagged: true, reasons: ['muitas_contas'] });
    expect(ours[2]).toMatchObject({ failures: 10, flagged: false, reasons: [] });
    expect(ours[3]).toMatchObject({ failures: 2, flagged: false });
    expect(new Date(ours[0]!.firstSeenAt).getTime()).toBeLessThanOrEqual(new Date(ours[0]!.lastSeenAt).getTime());
    expectNoForbiddenKeys(res.json());

    const audit = await h.one<{ n: string }>(
      `SELECT count(*) AS n FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'access_log' AND conta_id IS NULL AND usuario_id = $1 AND dados_depois->>'view' = 'flagged_ips'`,
      [sa.userId],
    );
    expect(Number(audit.n)).toBeGreaterThanOrEqual(1);
  });

  it('janela inválida: 400', async () => {
    expect((await h.call(sa.cookie, 'GET', `${BASE}/flagged-ips?window=1y`)).statusCode).toBe(400);
  });
});

describe('GET /access/sessions', () => {
  it('lista sessões com conta e e-mail, sem token; filtra por conta, usuário e ativas', async () => {
    const user = await h.loginAs(orgA, 'rh');
    const other = await h.loginAs(orgB, 'rh');
    const token = (await h.one<{ token: string }>('SELECT token FROM rh.sessoes WHERE usuario_id = $1', [user.userId])).token;

    const res = await h.call(sa.cookie, 'GET', `${BASE}/sessions?tenantId=${orgA.tenantId}&userId=${user.userId}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 25, total: 1 });
    expect(body.data[0]).toMatchObject({ tenantId: orgA.tenantId, tenantName: 'Conta Teste', userId: user.userId, role: 'rh', isActive: true });
    expect(body.data[0].userEmail).toMatch(/^rh\d+@portal\.teste\.dev$/);
    expect(JSON.stringify(body)).not.toContain(token);
    expectNoForbiddenKeys(body);

    const none = (await h.call(sa.cookie, 'GET', `${BASE}/sessions?tenantId=${orgA.tenantId}&userId=${other.userId}`)).json();
    expect(none.data).toHaveLength(0);

    await h.client.query("UPDATE rh.sessoes SET expira_em = now() - interval '1 hour' WHERE usuario_id = $1", [other.userId]);
    const inactive = (await h.call(sa.cookie, 'GET', `${BASE}/sessions?userId=${other.userId}&active=false`)).json();
    expect(inactive.data).toHaveLength(1);
    expect(inactive.data[0].isActive).toBe(false);
    const active = (await h.call(sa.cookie, 'GET', `${BASE}/sessions?userId=${other.userId}&active=true`)).json();
    expect(active.data).toHaveLength(0);
  });

  it('pagina e audita a leitura com os filtros', async () => {
    const res = (await h.call(sa.cookie, 'GET', `${BASE}/sessions?tenantId=${orgA.tenantId}&pageSize=1&page=2`)).json();
    expect(res.meta).toMatchObject({ page: 2, pageSize: 1 });
    expect(res.meta.total).toBeGreaterThan(1);
    expect(res.data.length).toBeLessThanOrEqual(1);
    const row = await h.one<{ dados_depois: Record<string, unknown> }>(
      `SELECT dados_depois FROM rh.auditorias WHERE acao = 'leitura_sensivel' AND entidade = 'access_log' AND conta_id = $1 AND dados_depois->>'view' = 'sessions' ORDER BY id DESC LIMIT 1`,
      [orgA.tenantId],
    );
    expect(row.dados_depois).toMatchObject({ tenantId: orgA.tenantId, page: 2, pageSize: 1 });
  });
});

describe('revogação de sessões', () => {
  const sessionIdOf = async (userId: number) => h.id('SELECT id FROM rh.sessoes WHERE usuario_id = $1 ORDER BY id DESC LIMIT 1', [userId]);

  it('revogar uma sessão derruba o cookie (401) e audita `exclusao` com motivo na conta dela', async () => {
    const victim = await h.loginAs(orgA, 'rh');
    expect((await h.call(victim.cookie, 'GET', '/me')).statusCode).toBe(200);
    const sessionId = await sessionIdOf(victim.userId);

    const res = await h.call(sa.cookie, 'POST', `${BASE}/sessions/${sessionId}/revoke`, { reason: 'Suspeita de acesso indevido' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { revoked: 1 } });
    expect((await h.call(victim.cookie, 'GET', '/me')).statusCode).toBe(401);

    const audit = await h.one<{ conta_id: string; usuario_id: string; acao: string; motivo: string; entidade_id: string }>(
      `SELECT conta_id, usuario_id, acao, motivo, entidade_id FROM rh.auditorias WHERE entidade = 'session' AND entidade_id = $1`,
      [sessionId],
    );
    expect(audit).toMatchObject({ conta_id: String(orgA.tenantId), usuario_id: String(sa.userId), acao: 'exclusao', motivo: 'Suspeita de acesso indevido' });
    // segunda vez: a sessão não existe mais
    expect((await h.call(sa.cookie, 'POST', `${BASE}/sessions/${sessionId}/revoke`, { reason: 'de novo para testar' })).statusCode).toBe(404);
  });

  it('sessão de super_admin: auditoria com conta nula', async () => {
    const other = await h.loginAsSuperAdmin();
    const sessionId = await sessionIdOf(other.userId);
    expect((await h.call(sa.cookie, 'POST', `${BASE}/sessions/${sessionId}/revoke`, { reason: 'Rotina de segurança' })).statusCode).toBe(200);
    const audit = await h.one<{ conta_id: string | null }>(`SELECT conta_id FROM rh.auditorias WHERE entidade = 'session' AND entidade_id = $1`, [sessionId]);
    expect(audit.conta_id).toBeNull();
  });

  it('exige motivo e sessão existente', async () => {
    expect((await h.call(sa.cookie, 'POST', `${BASE}/sessions/1/revoke`, {})).statusCode).toBe(400);
    expect((await h.call(sa.cookie, 'POST', `${BASE}/sessions/1/revoke`, { reason: 'ab' })).statusCode).toBe(400);
    const res = await h.call(sa.cookie, 'POST', `${BASE}/sessions/999999999/revoke`, { reason: 'sessão que não existe' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('revogar todas as sessões de um usuário', async () => {
    const user = await newUser(orgB, 'rh');
    const c1 = cookiesOf(await signIn(user.email, PASSWORD, h.app));
    const c2 = cookiesOf(await signIn(user.email, PASSWORD, h.app));
    expect((await h.call(c1, 'GET', '/me')).statusCode).toBe(200);
    expect((await h.call(c2, 'GET', '/me')).statusCode).toBe(200);

    const res = await h.call(sa.cookie, 'POST', `${BASE}/users/${user.id}/revoke-sessions`, { reason: 'Conta comprometida' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { revoked: 2 } });
    expect((await h.call(c1, 'GET', '/me')).statusCode).toBe(401);
    expect((await h.call(c2, 'GET', '/me')).statusCode).toBe(401);
    const audit = await h.one<{ conta_id: string; motivo: string; dados_depois: { revoked: number } }>(
      `SELECT conta_id, motivo, dados_depois FROM rh.auditorias WHERE entidade = 'session' AND entidade_id = $1 AND acao = 'exclusao'`,
      [user.id],
    );
    expect(audit).toMatchObject({ conta_id: String(orgB.tenantId), motivo: 'Conta comprometida', dados_depois: { revoked: 2 } });

    // sem sessões abertas: 0, ainda auditado
    expect((await h.call(sa.cookie, 'POST', `${BASE}/users/${user.id}/revoke-sessions`, { reason: 'Conferência final' })).json()).toEqual({ data: { revoked: 0 } });
    const missing = await h.call(sa.cookie, 'POST', `${BASE}/users/999999999/revoke-sessions`, { reason: 'usuário que não existe' });
    expect(missing.statusCode).toBe(404);
  });
});
