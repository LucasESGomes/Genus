/** Auditoria entre contas, sob /portal/super-admin. A guarda do papel está no escopo (../routes.ts). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../../http/schemas';
import { auditDetailResponse, auditListResponse, listAuditQuery } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { SuperAdminAuditService } from './service';

const tags = ['Super admin: auditoria'];

export const auditRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new SuperAdminAuditService(deps);

  app.get(
    '/audit-logs',
    { schema: { tags, summary: 'Lista a auditoria de todas as contas (cursor por id decrescente)', querystring: listAuditQuery, response: { 200: auditListResponse } } },
    async (req) => service.list(req.ctx!, req.query),
  );
  app.get(
    '/audit-logs/:id',
    { schema: { tags, summary: 'Detalhe de uma linha de auditoria (antes/depois redigidos)', params: idParams, response: { 200: auditDetailResponse } } },
    async (req) => ({ data: await service.get(req.ctx!, req.params.id) }),
  );
};
