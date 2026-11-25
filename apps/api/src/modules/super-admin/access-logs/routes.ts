/** Acessos entre contas, sob /portal/super-admin. A guarda do papel está no escopo (../routes.ts). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  flaggedIpListResponse,
  listLoginAttemptsQuery,
  listSessionsQuery,
  loginAttemptListResponse,
  revokeBody,
  revokeResponse,
  sessionIdParams,
  sessionListResponse,
  userIdParams,
  windowQuery,
} from '../contract';
import type { SuperAdminDeps } from '../deps';
import { AccessLogService } from './service';

const tags = ['Super admin: acessos'];

export const accessLogRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new AccessLogService(deps);

  app.get(
    '/access/sessions',
    { schema: { tags, summary: 'Sessões de todas as contas (sem token)', querystring: listSessionsQuery, response: { 200: sessionListResponse } } },
    async (req) => service.listSessions(req.ctx!, req.query),
  );
  app.get(
    '/access/login-attempts',
    { schema: { tags, summary: 'Tentativas de login (cursor por id decrescente; sem e-mail)', querystring: listLoginAttemptsQuery, response: { 200: loginAttemptListResponse } } },
    async (req) => service.listLoginAttempts(req.ctx!, req.query),
  );
  app.get(
    '/access/flagged-ips',
    { schema: { tags, summary: 'IPs com falhas de login, sinalizados por excesso de falhas ou de contas', querystring: windowQuery, response: { 200: flaggedIpListResponse } } },
    async (req) => ({ data: await service.flaggedIps(req.ctx!, req.query.window) }),
  );
  app.post(
    '/access/sessions/:sessionId/revoke',
    { schema: { tags, summary: 'Revoga uma sessão (auditado, com motivo)', params: sessionIdParams, body: revokeBody, response: { 200: revokeResponse } } },
    async (req) => ({ data: await service.revokeSession(req.ctx!, req.params.sessionId, req.body.reason) }),
  );
  app.post(
    '/access/users/:userId/revoke-sessions',
    { schema: { tags, summary: 'Revoga todas as sessões de um usuário (auditado, com motivo)', params: userIdParams, body: revokeBody, response: { 200: revokeResponse } } },
    async (req) => ({ data: await service.revokeUserSessions(req.ctx!, req.params.userId, req.body.reason) }),
  );
};
