/**
 * Convites de uma conta pelo super_admin. A guarda `authorize('super_admin')` está no escopo pai; a conta
 * vem do parâmetro de rota. Regras no mesmo service do admin (modules/invites/service.ts).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createdInviteResponse, createInviteBody, inviteIdParams, inviteListResponse, inviteResponse } from '../../invites/schemas';
import { InviteService } from '../../invites/service';
import { tenantIdParams } from '../contract';
import type { SuperAdminDeps } from '../deps';

const tags = ['Super admin: convites'];
const params = tenantIdParams.extend(inviteIdParams.shape);

export const tenantInviteRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new InviteService({ db: deps.db, clock: deps.clock, cpfHashKey: deps.inviteCpfHashKey });

  app.get(
    '/tenants/:tenantId/invites',
    { schema: { tags, summary: 'Lista os convites da conta', params: tenantIdParams, response: { 200: inviteListResponse } } },
    async (req) => ({ data: await service.list(req.params.tenantId) }),
  );

  app.post(
    '/tenants/:tenantId/invites',
    {
      schema: {
        tags,
        summary: 'Convida um admin ou rh para a conta; o token do link sai só nesta resposta',
        params: tenantIdParams,
        body: createInviteBody,
        response: { 201: createdInviteResponse },
      },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      const actor = { tenantId: req.params.tenantId, userId: req.ctx!.userId };
      return reply.code(201).send({ data: await service.create(actor, req.body) });
    },
  );

  app.post(
    '/tenants/:tenantId/invites/:inviteId/revoke',
    { schema: { tags, summary: 'Revoga um convite pendente da conta', params, response: { 200: inviteResponse } } },
    async (req) => ({
      data: await service.revoke({ tenantId: req.params.tenantId, userId: req.ctx!.userId }, req.params.inviteId),
    }),
  );
};
