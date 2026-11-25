/**
 * Autenticação do portal (Better Auth): cookie de sessão, JWT curto, TOTP, papéis
 * e conta vinda só da sessão. Contra Postgres real (Testcontainers) e com as rotas
 * de verdade (`app.inject`). Usuários, senhas e segredos são fictícios.
 */
import { createHmac, generateKeyPairSync, sign as edSign } from 'node:crypto';
import { Writable } from 'node:stream';
import { createLogger, SystemClock } from '@genus/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createDatabase, type DatabaseHandle } from '../src/db/client';
import { createAuth, type AuthConfig } from '../src/modules/auth/auth';
import { UserService } from '../src/modules/auth/user-service';
import { FAKE_PIN_HASH, FAKE_PIN_SET_AT } from './support/fake-pin';
import { startRhTestDatabase, type RhTestDatabase } from './support/rh-database';

const BASE_URL = 'http://localhost:3002';
const ORIGIN = { origin: BASE_URL };
const SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';
const PASSWORD = 'senha-ficticia-forte-123';

let db: RhTestDatabase;
let client: pg.Client;
let handle: DatabaseHandle;
let users: UserService;
let seq = 0;
const logLines: string[] = [];
const apps: FastifyInstance[] = [];

async function newApp(overrides: Partial<AuthConfig> = {}): Promise<FastifyInstance> {
  const logger = createLogger({
    level: 'debug',
    service: 'test',
    destination: new Writable({
      write(chunk: Buffer, _enc, cb) {
        logLines.push(chunk.toString());
        cb();
      },
    }),
  });
  const auth = createAuth(
    handle.db,
    { secret: SECRET, baseURL: BASE_URL, trustedOrigins: [], secureCookies: false, rateLimit: false, ...overrides },
    logger,
  );
  const app = await buildApp({ logger, pool: handle.pool, db: handle.db, corsOrigins: [], auth: { auth, baseURL: BASE_URL, clock: new SystemClock() } });
  // Rota só para o teste de papel: produção usa o mesmo app.authorize nos módulos.
  app.get('/test/rh-only', { preHandler: [app.authorize('rh', 'admin')] }, async (req) => ({ data: { role: req.ctx?.role } }));
  apps.push(app);
  return app;
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await client.query(sql, params)).rows[0] as T;
}

interface Org {
  tenantId: number;
  establishmentId: number;
  employeeId: number;
}

async function createOrg(): Promise<Org> {
  seq += 1;
  const tenantId = Number((await one<{ id: string }>("INSERT INTO rh.contas (nome) VALUES ('Conta Auth') RETURNING id")).id);
  const doc = String(98_765_432_000_100 + seq);
  const companyId = Number(
    (await one<{ id: string }>('INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, $2, $3) RETURNING id', [tenantId, 'Auth Ltda', doc])).id,
  );
  const establishmentId = Number(
    (
      await one<{ id: string }>(
        `INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge)
         VALUES ($1, $2, 'Matriz', 'CNPJ', $3, 'SP', '3550308') RETURNING id`,
        [tenantId, companyId, doc],
      )
    ).id,
  );
  const employeeId = Number(
    (
      await one<{ id: string }>(
        `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao, pin_hash, pin_definido_em)
         VALUES ($1, $2, $3, 'Pessoa Fictícia', '1990-01-01', '2025-01-01', $4, $5) RETURNING id`,
        [tenantId, establishmentId, String(10_000_000_000 + seq), FAKE_PIN_HASH, FAKE_PIN_SET_AT],
      )
    ).id,
  );
  return { tenantId, establishmentId, employeeId };
}

/** Cookies `nome=valor` da resposta, para mandar de volta. */
function cookiesOf(res: LightMyRequestResponse): string {
  const raw = res.headers['set-cookie'];
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ');
}

async function signIn(app: FastifyInstance, email: string, password = PASSWORD) {
  return app.inject({ method: 'POST', url: '/auth/sign-in/email', headers: ORIGIN, payload: { email, password } });
}

async function login(app: FastifyInstance, email: string): Promise<string> {
  const res = await signIn(app, email);
  expect(res.statusCode).toBe(200);
  return cookiesOf(res);
}

const me = (app: FastifyInstance, headers: Record<string, string>) => app.inject({ method: 'GET', url: '/me', headers });

async function createUser(org: Org | null, role: 'admin' | 'rh' | 'gestor' | 'colaborador' | 'super_admin', employeeId: number | null = null) {
  seq += 1;
  return users.createUser({
    tenantId: org?.tenantId ?? null,
    email: `${role}${seq}@auth.teste.dev`,
    name: `Usuário ${role} ${seq}`,
    role,
    employeeId,
    password: PASSWORD,
  });
}

// ---------------------------------------------------------------- TOTP (RFC 6238)
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
  const h = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

/** Liga o 2FA de quem está logado e devolve o segredo base32 (do otpauth://). */
async function enableTotp(app: FastifyInstance, cookie: string): Promise<{ secret: string; cookie: string }> {
  const enable = await app.inject({ method: 'POST', url: '/auth/two-factor/enable', headers: { ...ORIGIN, cookie }, payload: { password: PASSWORD } });
  expect(enable.statusCode).toBe(200);
  const secret = new URL(enable.json<{ totpURI: string }>().totpURI).searchParams.get('secret')!;
  const verify = await app.inject({ method: 'POST', url: '/auth/two-factor/verify-totp', headers: { ...ORIGIN, cookie }, payload: { code: totp(secret) } });
  expect(verify.statusCode).toBe(200);
  return { secret, cookie: cookiesOf(verify) || cookie };
}

beforeAll(async () => {
  db = await startRhTestDatabase();
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
  handle = createDatabase(db.url, createLogger({ level: 'silent', service: 'test' }), 4);
  users = new UserService({ db: handle.db });
});

afterAll(async () => {
  for (const app of apps) await app.close();
  await handle?.close();
  await client?.end();
  await db?.stop();
});

describe('login com e-mail e senha', () => {
  it('usuário criado pelo serviço entra e recebe cookie httpOnly; a senha fica só como hash', async () => {
    const app = await newApp();
    const org = await createOrg();
    const user = await createUser(org, 'rh');
    const res = await signIn(app, user.email);
    expect(res.statusCode).toBe(200);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/genus\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);

    const cred = await one<{ senha_hash: string; conta_id: string }>('SELECT senha_hash, conta_id FROM rh.credenciais_login WHERE usuario_id = $1', [user.id]);
    expect(cred.senha_hash).not.toContain(PASSWORD);
    expect(Number(cred.conta_id)).toBe(org.tenantId);
    // Sessão herda a conta do usuário (trigger 0008)
    const sess = await one<{ conta_id: string }>('SELECT conta_id FROM rh.sessoes WHERE usuario_id = $1', [user.id]);
    expect(Number(sess.conta_id)).toBe(org.tenantId);
  });

  it('senha errada e e-mail inexistente → 401, sem cookie', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    for (const res of [await signIn(app, user.email, 'senha-errada-123456'), await signIn(app, 'ninguem@auth.teste.dev')]) {
      expect(res.statusCode).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('cadastro público desligado: sign-up recusado e nada gravado', async () => {
    const app = await newApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up/email',
      headers: ORIGIN,
      payload: { email: 'intruso@auth.teste.dev', password: PASSWORD, name: 'Intruso' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM rh.usuarios WHERE email = 'intruso@auth.teste.dev'")).n).toBe(0);
  });

  it('usuário inativo não entra, e desativar derruba a sessão aberta', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'gestor');
    const cookie = await login(app, user.email);
    expect((await me(app, { cookie })).statusCode).toBe(200);

    await client.query('UPDATE rh.usuarios SET ativo = false WHERE id = $1', [user.id]);
    expect((await me(app, { cookie })).statusCode).toBe(401);
    const again = await signIn(app, user.email);
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(again.headers['set-cookie'] ?? '').not.toMatch(/session_token=[^;]+/);
  });

  it('serviço recusa senha curta, colaborador sem colaborador_id e conta no super_admin', async () => {
    const org = await createOrg();
    const base = { tenantId: org.tenantId, email: 'x@auth.teste.dev', name: 'X', employeeId: null, password: PASSWORD };
    await expect(users.createUser({ ...base, role: 'rh', password: 'curta' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(users.createUser({ ...base, role: 'colaborador' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(users.createUser({ ...base, role: 'super_admin' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('limite de tentativas: rajada de senhas erradas recebe 429', async () => {
    const app = await newApp({ rateLimit: true });
    const user = await createUser(await createOrg(), 'rh');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await signIn(app, user.email, `errada-${i}-000000000`)).statusCode);
    expect(codes).toContain(429);
  });
});

describe('sessão e contexto (req.ctx)', () => {
  it('/me sem sessão → 401 no envelope de erro', async () => {
    const app = await newApp();
    const res = await me(app, {});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Faça login para continuar', code: 'UNAUTHORIZED' });
  });

  it('/me com cookie devolve o próprio usuário, sem hash nem token', async () => {
    const app = await newApp();
    const org = await createOrg();
    const user = await createUser(org, 'rh');
    const res = await me(app, { cookie: await login(app, user.email) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({
      id: user.id,
      tenantId: org.tenantId,
      employeeId: null,
      name: user.name,
      email: user.email,
      role: 'rh',
      mfaEnabled: false,
      establishmentScope: null,
      authenticatedVia: 'cookie',
    });
    expect(res.body).not.toMatch(/senha|password|token|secret/i);
  });

  it('conta vem só da sessão: header, query e corpo do cliente são ignorados', async () => {
    const app = await newApp();
    const org = await createOrg();
    const other = await createOrg();
    const user = await createUser(org, 'admin');
    const cookie = await login(app, user.email);
    const res = await app.inject({
      method: 'GET',
      url: `/me?tenantId=${other.tenantId}&conta_id=${other.tenantId}`,
      headers: { cookie, 'x-tenant-id': String(other.tenantId), 'x-conta-id': String(other.tenantId) },
    });
    expect(res.json().data.tenantId).toBe(org.tenantId);
  });

  it('escopo por estabelecimento vem de usuarios_estabelecimentos', async () => {
    const app = await newApp();
    const org = await createOrg();
    const user = await createUser(org, 'gestor');
    await client.query('INSERT INTO rh.usuarios_estabelecimentos (conta_id, usuario_id, estabelecimento_id) VALUES ($1, $2, $3)', [
      org.tenantId,
      user.id,
      org.establishmentId,
    ]);
    const res = await me(app, { cookie: await login(app, user.email) });
    expect(res.json().data.establishmentScope).toEqual([org.establishmentId]);
  });

  it('sign-out invalida o cookie', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    const cookie = await login(app, user.email);
    const out = await app.inject({ method: 'POST', url: '/auth/sign-out', headers: { ...ORIGIN, cookie } });
    expect(out.statusCode).toBe(200);
    expect((await me(app, { cookie })).statusCode).toBe(401);
  });
});

describe('papéis (app.authorize)', () => {
  it('rh passa; colaborador e gestor recebem 403', async () => {
    const app = await newApp();
    const org = await createOrg();
    const rh = await createUser(org, 'rh');
    const collaborator = await createUser(org, 'colaborador', org.employeeId);
    const manager = await createUser(org, 'gestor');

    const ok = await app.inject({ method: 'GET', url: '/test/rh-only', headers: { cookie: await login(app, rh.email) } });
    expect(ok.statusCode).toBe(200);
    for (const u of [collaborator, manager]) {
      const res = await app.inject({ method: 'GET', url: '/test/rh-only', headers: { cookie: await login(app, u.email) } });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN');
    }
    expect((await app.inject({ method: 'GET', url: '/test/rh-only' })).statusCode).toBe(401);
  });

  it('colaborador vê o próprio employeeId no ctx', async () => {
    const app = await newApp();
    const org = await createOrg();
    const collaborator = await createUser(org, 'colaborador', org.employeeId);
    const res = await me(app, { cookie: await login(app, collaborator.email) });
    expect(res.json().data).toMatchObject({ role: 'colaborador', employeeId: org.employeeId });
  });

  it('banco: aceita colaborador, recusa o antigo funcionario', async () => {
    const org = await createOrg();
    const state = async (role: string) => {
      try {
        await client.query("INSERT INTO rh.usuarios (conta_id, email, nome, papel, colaborador_id) VALUES ($1, $2, 'P', $3, NULL)", [
          org.tenantId,
          `papel-${role}-${seq}@auth.teste.dev`,
          role,
        ]);
        return 'ok';
      } catch (e) {
        return (e as { constraint?: string }).constraint;
      }
    };
    expect(await state('funcionario')).toBe('usuario_papel');
    expect(await state('colaborador')).toBe('usuario_colaborador_tem_colaborador');
  });
});

describe('JWT curto (GET /auth/token)', () => {
  async function tokenFor(app: FastifyInstance, cookie: string): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/auth/token', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    return res.json<{ token: string }>().token;
  }

  it('Bearer válido dá o mesmo ctx do cookie; JWKS publica só a chave pública', async () => {
    const app = await newApp();
    const org = await createOrg();
    const user = await createUser(org, 'rh');
    const token = await tokenFor(app, await login(app, user.email));
    const res = await me(app, { authorization: `Bearer ${token}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ id: user.id, tenantId: org.tenantId, role: 'rh', authenticatedVia: 'jwt' });

    const jwks = await app.inject({ method: 'GET', url: '/auth/jwks' });
    expect(jwks.statusCode).toBe(200);
    const keys = jwks.json<{ keys: Record<string, unknown>[] }>().keys;
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).not.toHaveProperty('d'); // parte privada
    const stored = await one<{ chave_privada: string }>('SELECT chave_privada FROM rh.chaves_jwt LIMIT 1');
    expect(stored.chave_privada).not.toMatch(/"d"\s*:/); // privada cifrada no banco
  });

  it('JWT adulterado, sem formato ou com outro esquema → 401', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    const token = await tokenFor(app, await login(app, user.email));
    const [h, p, s] = token.split('.') as [string, string, string];
    const flipped = s.slice(0, -2) + (s.endsWith('AA') ? 'BB' : 'AA');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    const otherUser = Buffer.from(JSON.stringify({ ...payload, sub: '999999' })).toString('base64url');
    for (const authorization of [`Bearer ${h}.${p}.${flipped}`, `Bearer ${h}.${otherUser}.${s}`, 'Bearer abc', `Basic ${token}`]) {
      expect((await me(app, { authorization })).statusCode).toBe(401);
    }
  });

  it('JWT assinado com outra chave (mesmo kid) → 401', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    const token = await tokenFor(app, await login(app, user.email));
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString()) as Record<string, unknown>;
    const payload = token.split('.')[1]!;
    const { privateKey } = generateKeyPairSync('ed25519');
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const sig = edSign(null, Buffer.from(`${h}.${payload}`), privateKey).toString('base64url');
    expect((await me(app, { authorization: `Bearer ${h}.${payload}.${sig}` })).statusCode).toBe(401);
  });

  it('JWT expirado → 401', async () => {
    const app = await newApp({ jwtExpiration: '1s' });
    const user = await createUser(await createOrg(), 'rh');
    const token = await tokenFor(app, await login(app, user.email));
    await new Promise((r) => setTimeout(r, 2100));
    expect((await me(app, { authorization: `Bearer ${token}` })).statusCode).toBe(401);
  });

  it('sign-out revoga também o JWT ainda válido', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    const cookie = await login(app, user.email);
    const token = await tokenFor(app, cookie);
    expect((await me(app, { authorization: `Bearer ${token}` })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/auth/sign-out', headers: { ...ORIGIN, cookie } });
    expect((await me(app, { authorization: `Bearer ${token}` })).statusCode).toBe(401);
  });

  it('troca de papel vale na hora, mesmo com JWT antigo', async () => {
    const app = await newApp();
    const org = await createOrg();
    const user = await createUser(org, 'rh');
    const token = await tokenFor(app, await login(app, user.email));
    await client.query("UPDATE rh.usuarios SET papel = 'gestor' WHERE id = $1", [user.id]);
    const res = await app.inject({ method: 'GET', url: '/test/rh-only', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(403);
  });
});

describe('2FA (TOTP)', () => {
  it('ativa, passa a exigir o código no login, recusa código errado e aceita o certo', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    const first = await login(app, user.email);
    const { secret, cookie } = await enableTotp(app, first);
    expect((await one<{ mfa_ativo: boolean }>('SELECT mfa_ativo FROM rh.usuarios WHERE id = $1', [user.id])).mfa_ativo).toBe(true);
    const stored = await one<{ segredo: string; codigos_backup: string }>('SELECT segredo, codigos_backup FROM rh.dois_fatores WHERE usuario_id = $1', [user.id]);
    expect(stored.segredo).not.toContain(secret); // cifrado
    await app.inject({ method: 'POST', url: '/auth/sign-out', headers: { ...ORIGIN, cookie } });

    // Senha certa não basta: pede o segundo fator, sem sessão ainda
    const step1 = await signIn(app, user.email);
    expect(step1.statusCode).toBe(200);
    expect(step1.json()).toMatchObject({ twoFactorRedirect: true });
    const pending = cookiesOf(step1);
    expect((await me(app, { cookie: pending })).statusCode).toBe(401);

    const wrong = String((Number(totp(secret)) + 1) % 1_000_000).padStart(6, '0');
    const bad = await app.inject({ method: 'POST', url: '/auth/two-factor/verify-totp', headers: { ...ORIGIN, cookie: pending }, payload: { code: wrong } });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);

    const good = await app.inject({
      method: 'POST',
      url: '/auth/two-factor/verify-totp',
      headers: { ...ORIGIN, cookie: pending },
      payload: { code: totp(secret, Date.now() + 30_000) }, // próximo passo (janela aceita ±1), evita reuso do código da ativação
    });
    expect(good.statusCode).toBe(200);
    const res = await me(app, { cookie: cookiesOf(good) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.mfaEnabled).toBe(true);
  });

  it('super_admin sem 2FA só consegue ativar o 2FA; depois opera normalmente', async () => {
    const app = await newApp();
    const root = await createUser(null, 'super_admin');
    const cookie = await login(app, root.email);
    const blocked = await me(app, { cookie });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MFA_REQUIRED');

    const enabled = await enableTotp(app, cookie);
    const res = await me(app, { cookie: enabled.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ role: 'super_admin', tenantId: null, mfaEnabled: true });
  });
});

describe('vazamento', () => {
  it('log não traz senha, hash, token de sessão, JWT nem segredo TOTP', async () => {
    const app = await newApp();
    const user = await createUser(await createOrg(), 'rh');
    const cookie = await login(app, user.email);
    const token = (await app.inject({ method: 'GET', url: '/auth/token', headers: { cookie } })).json<{ token: string }>().token;
    await me(app, { authorization: `Bearer ${token}` });
    const sessionToken = /session_token=([^;.]+)/.exec(cookie)?.[1] ?? 'sem-token';
    const hash = (await one<{ senha_hash: string }>('SELECT senha_hash FROM rh.credenciais_login WHERE usuario_id = $1', [user.id])).senha_hash;
    const secrets = (await client.query<{ segredo: string }>('SELECT segredo FROM rh.dois_fatores')).rows.map((r) => r.segredo);

    const all = logLines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const s of [PASSWORD, hash, sessionToken, token, SECRET, ...secrets]) expect(all).not.toContain(s);
  });
});
