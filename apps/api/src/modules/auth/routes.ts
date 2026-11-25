/**
 * Ponte Fastify → Better Auth: toda requisição em /auth/* vira um `Request` web e
 * vai para `auth.handler`. Rotas usadas pelo portal (todas do Better Auth):
 *
 *   POST /auth/sign-in/email          e-mail + senha → cookie (ou { twoFactorRedirect })
 *   POST /auth/two-factor/verify-totp segundo fator → cookie
 *   POST /auth/two-factor/enable      gera o segredo TOTP (pede a senha)
 *   POST /auth/sign-out               encerra a sessão
 *   GET  /auth/get-session            sessão atual
 *   GET  /auth/token                  JWT curto (precisa de sessão)
 *   GET  /auth/jwks                   chave pública do JWT
 *
 * O cadastro público (/auth/sign-up/email) está desligado na configuração.
 */
import type { Clock } from '@genus/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Database } from '../../db/client';
import { loginAttempts, users, verifications } from '../../db/schema';
import { hashLoginEmail } from '../super-admin/access-logs/email-hash';
import { classifyLoginOutcome, type LoginStep } from '../super-admin/access-logs/login-outcome';
import { AUTH_BASE_PATH, CLIENT_IP_HEADER, SESSION_COOKIE_PREFIX, type Auth } from './auth';

export function toWebRequest(req: FastifyRequest, baseURL: string): Request {
  const headers = fromNodeHeaders(req.headers);
  // O IP para o limite de tentativas é o que o Fastify vê, nunca um header do cliente.
  headers.set(CLIENT_IP_HEADER, req.ip);
  // baseURL é só a origem (env.ts garante); req.url já traz /auth/...
  const target = new URL(req.url, baseURL);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null;
  return new Request(target, {
    method: req.method,
    headers,
    body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
  });
}

export async function sendWebResponse(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.status(response.status);
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  const text = await response.text();
  return reply.send(text.length > 0 ? text : null);
}

const SIGN_IN_PATH = `${AUTH_BASE_PATH}/sign-in/email`;
const TOTP_PATH = `${AUTH_BASE_PATH}/two-factor/verify-totp`;
const TWO_FACTOR_COOKIE = `${SESSION_COOKIE_PREFIX}.two_factor`;
const USER_AGENT_MAX = 300;

/** Registro das tentativas de login (painel do super_admin, `tentativas_login`). Sem ele, nada é gravado. */
export interface LoginAttemptOptions {
  db: Database;
  clock: Clock;
  /** Chave do HMAC do e-mail: `deriveEmailHashKey(<segredo do Better Auth>)`. */
  emailHashKey: Buffer;
}

interface PendingAttempt {
  step: LoginStep;
  /** E-mail do corpo (senha) ou do usuário do desafio 2FA (totp); '' se o corpo não trouxe e-mail. */
  email: string;
  /** Usuário já conhecido (totp). */
  userId: number | null;
}

/**
 * No passo TOTP não há e-mail no corpo: o usuário vem do cookie assinado `genus.two_factor`, que aponta
 * para uma linha de `verificacoes` com o id do usuário (criada no passo da senha). Lido ANTES do handler,
 * que consome essa linha. A assinatura não é conferida aqui (só atribui a tentativa; o Better Auth confere).
 * Sem cookie válido, devolve null e a tentativa não é gravada.
 */
async function resolveTotpUser(db: Database, req: FastifyRequest): Promise<number | null> {
  const raw = req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${TWO_FACTOR_COOKIE}=`));
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw.slice(TWO_FACTOR_COOKIE.length + 1));
  } catch {
    return null;
  }
  const dot = value.lastIndexOf('.');
  const identifier = dot > 0 ? value.slice(0, dot) : value;
  if (!identifier.startsWith('2fa-')) return null;
  const [row] = await db.select({ value: verifications.value }).from(verifications).where(eq(verifications.identifier, identifier)).limit(1);
  const id = Number(row?.value);
  return Number.isSafeInteger(id) ? id : null;
}

async function recordLoginAttempt(
  la: LoginAttemptOptions,
  p: PendingAttempt,
  outcome: NonNullable<ReturnType<typeof classifyLoginOutcome>>,
  ip: string,
  userAgent: string | null,
): Promise<void> {
  let userId = p.userId;
  let tenantId: number | null = null;
  const email = p.email.trim();
  if (userId !== null) {
    const [u] = await la.db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
    tenantId = u?.tenantId ?? null;
  } else if (email !== '') {
    const [u] = await la.db.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.email, email)).limit(1);
    userId = u?.id ?? null;
    tenantId = u?.tenantId ?? null;
  }
  await la.db.insert(loginAttempts).values({
    tenantId,
    userId,
    emailHash: hashLoginEmail(la.emailHashKey, email),
    ipAddress: ip,
    userAgent,
    step: p.step,
    isSuccess: outcome.isSuccess,
    failureReason: outcome.failureReason,
    createdAt: la.clock.now(),
  });
}

export async function authRoutes(app: FastifyInstance, opts: { auth: Auth; baseURL: string; loginAttempts?: LoginAttemptOptions }): Promise<void> {
  const la = opts.loginAttempts;
  if (la) {
    const pending = new WeakMap<FastifyRequest, PendingAttempt>();

    app.addHook('preHandler', async (req) => {
      if (req.method !== 'POST') return;
      const path = req.url.split('?')[0];
      try {
        if (path === SIGN_IN_PATH) {
          const email = (req.body as { email?: unknown } | null | undefined)?.email;
          pending.set(req, { step: 'senha', email: typeof email === 'string' ? email : '', userId: null });
        } else if (path === TOTP_PATH) {
          // Sem desafio 2FA (cookie ausente ou vencido) não é tentativa de login: é a verificação da ativação
          // do 2FA (com sessão) ou lixo, que o Better Auth recusa de qualquer forma. Nada é gravado.
          const userId = await resolveTotpUser(la.db, req);
          if (userId === null) return;
          const [u] = await la.db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
          pending.set(req, { step: 'totp', email: u?.email ?? '', userId });
        }
      } catch (err) {
        req.log.warn({ err: { name: (err as Error).name } }, 'login: não foi possível identificar a tentativa');
      }
    });

    // Fire-and-forget: a gravação nunca atrasa nem derruba a resposta de login. O corpo de erro do Better
    // Auth traz `code`; e-mail e hash nunca vão para o log.
    app.addHook('onSend', async (req, reply, payload) => {
      const p = pending.get(req);
      if (!p) return payload;
      pending.delete(req);
      let code: string | undefined;
      if (reply.statusCode >= 400 && typeof payload === 'string') {
        try {
          const parsed = JSON.parse(payload) as { code?: unknown };
          if (typeof parsed.code === 'string') code = parsed.code;
        } catch {
          // corpo que não é JSON: sem código
        }
      }
      const outcome = classifyLoginOutcome(p.step, reply.statusCode, code);
      if (outcome) {
        const userAgent = req.headers['user-agent'];
        void recordLoginAttempt(la, p, outcome, req.ip, typeof userAgent === 'string' ? userAgent.slice(0, USER_AGENT_MAX) : null).catch((err: unknown) => {
          req.log.warn({ err: { name: (err as Error).name, code: (err as { code?: string }).code } }, 'login: tentativa não registrada');
        });
      }
      return payload;
    });
  }

  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    schema: { hide: true },
    handler: async (req, reply) => sendWebResponse(reply, await opts.auth.handler(toWebRequest(req, opts.baseURL))),
  });
}
