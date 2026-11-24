/**
 * `req.ctx` a partir da sessão (backend.md §4). Aceita:
 *   - cookie de sessão do Better Auth (portal web);
 *   - `Authorization: Bearer <JWT>` emitido por GET /auth/token (app, integrações).
 *
 * Papel, conta e colaborador são SEMPRE relidos de `usuarios` a cada requisição: o
 * JWT só identifica a sessão (`sid`) e o usuário (`sub`). Assim, sign-out, usuário
 * desativado ou troca de papel valem na hora, também para um JWT ainda não expirado.
 *
 * `tenantId` nunca vem do corpo, da query nem de header do cliente.
 */
import type { Clock } from '@genus/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Database } from '../db/client';
import { sessions, userEstablishments, users } from '../db/schema';
import type { Auth } from '../modules/auth/auth';
import { HttpError } from './error-handler';

export const ROLES = ['super_admin', 'admin', 'rh', 'gestor', 'contador', 'colaborador'] as const;
export type Role = (typeof ROLES)[number];

export interface RequestContext {
  tenantId: number | null;
  userId: number;
  employeeId: number | null;
  role: Role;
  sessionId: number;
  /** Estabelecimentos que o usuário enxerga. `null` = a conta inteira. */
  establishmentScope: number[] | null;
  /** Como o usuário se autenticou. */
  via: 'cookie' | 'jwt';
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext | null;
  }
  interface FastifyInstance {
    /** preHandler: 401 sem sessão válida; preenche `req.ctx`. */
    authenticate: preHandlerAsyncHookHandler;
    /** preHandler: autentica e barra (403) quem não tem um dos papéis. */
    authorize: (...roles: Role[]) => preHandlerAsyncHookHandler;
  }
}

const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Faça login para continuar');

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface RequestContextOptions {
  auth: Auth;
  db: Database;
  clock: Clock;
}

async function resolveSession(req: FastifyRequest, o: RequestContextOptions): Promise<{ userId: number; sessionId: number; via: RequestContext['via'] } | null> {
  const authorization = req.headers.authorization;
  if (authorization !== undefined) {
    const [scheme, token] = authorization.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token || !JWT_SHAPE.test(token)) return null;
    const result = await o.auth.api.verifyJWT({ body: { token } });
    const payload = result?.payload as { sub?: string; sid?: string } | null | undefined;
    const userId = Number(payload?.sub);
    const sessionId = Number(payload?.sid);
    if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(sessionId)) return null;
    // A sessão de origem precisa continuar viva (sign-out revoga o JWT também).
    const [alive] = await o.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, o.clock.now())))
      .limit(1);
    return alive ? { userId, sessionId, via: 'jwt' } : null;
  }

  const found = await o.auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableRefresh: true } });
  if (!found) return null;
  return { userId: Number(found.user.id), sessionId: Number(found.session.id), via: 'cookie' };
}

async function buildContext(req: FastifyRequest, o: RequestContextOptions): Promise<RequestContext> {
  const session = await resolveSession(req, o);
  if (!session) throw unauthorized();

  const [user] = await o.db
    .select({ tenantId: users.tenantId, employeeId: users.employeeId, role: users.role, isActive: users.isActive, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user?.isActive) throw unauthorized();
  const role = user.role as Role;

  // super_admin só opera com 2FA ativo; sem ele, a sessão serve apenas para ativá-lo (/auth/two-factor/*).
  if (role === 'super_admin' && !user.mfaEnabled) {
    throw new HttpError(403, 'FORBIDDEN', 'Ative a verificação em duas etapas para continuar');
  }

  let establishmentScope: number[] | null = null;
  if (user.tenantId !== null) {
    const rows = await o.db
      .select({ establishmentId: userEstablishments.establishmentId })
      .from(userEstablishments)
      .where(and(eq(userEstablishments.tenantId, user.tenantId), eq(userEstablishments.userId, session.userId)));
    if (rows.length > 0) establishmentScope = rows.map((r) => Number(r.establishmentId));
  }

  return {
    tenantId: user.tenantId === null ? null : Number(user.tenantId),
    userId: session.userId,
    employeeId: user.employeeId === null ? null : Number(user.employeeId),
    role,
    sessionId: session.sessionId,
    establishmentScope,
    via: session.via,
  };
}

/** Chamada direto na instância raiz (não via register), para os decorators valerem em todas as rotas. */
export function registerRequestContext(app: FastifyInstance, o: RequestContextOptions): void {
  app.decorateRequest('ctx', null);

  const authenticate: preHandlerAsyncHookHandler = async function (req) {
    req.ctx ??= await buildContext(req, o);
  };
  app.decorate('authenticate', authenticate);
  app.decorate('authorize', (...roles: Role[]): preHandlerAsyncHookHandler => {
    return async function (req, reply) {
      await authenticate.call(this, req, reply);
      if (!req.ctx || !roles.includes(req.ctx.role)) {
        throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
      }
    };
  });
}

