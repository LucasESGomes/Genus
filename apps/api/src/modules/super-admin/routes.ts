/**
 * Painel do super_admin, sob /portal/super-admin. A guarda fica no ESCOPO (onRequest, antes da
 * validação): nenhuma rota registrada aqui dentro escapa dela, e nenhum papel de cliente passa.
 * O super_admin sem 2FA já cai no request-context (403).
 *
 * `tenantId` de outra conta vem sempre do parâmetro de rota ou da query validados, nunca do corpo.
 */
import type { onRequestAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accessLogRoutes } from './access-logs/routes';
import { auditRoutes } from './audit/routes';
import type { SuperAdminDeps } from './deps';
import { recognitionRoutes } from './recognition-logs/routes';
import { statsRoutes } from './stats/routes';
import { systemHealthRoutes } from './system-health/routes';
import { tenantRoutes } from './tenants/routes';

export const superAdminRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authorize('super_admin') as unknown as onRequestAsyncHookHandler);

  await app.register(tenantRoutes, deps);
  await app.register(auditRoutes, deps);
  await app.register(accessLogRoutes, deps);
  await app.register(recognitionRoutes, deps);
  await app.register(statsRoutes, deps);
  await app.register(systemHealthRoutes, deps);
};
