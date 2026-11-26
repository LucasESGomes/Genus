/**
 * Convites sob /portal: o `admin` convida `admin` e `rh` para a própria conta (a da sessão), e as duas
 * rotas públicas do aceite (public-routes.ts). Admin restrito a alguns estabelecimentos recebe 403: o
 * usuário criado pelo convite enxerga a conta inteira.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import type { PortalDeps } from '../portal/deps';
import { publicInviteRoutes } from './public-routes';
import { createdInviteResponse, createInviteBody, inviteIdParams, inviteListResponse, inviteResponse } from './schemas';
import { InviteService, type InviteActor } from './service';

const tags = ['Convites'];

function actorOf(ctx: RequestContext): InviteActor {
  if (ctx.establishmentScope !== null) throw new HttpError(403, 'FORBIDDEN', 'Só o administrador da conta inteira pode gerenciar convites');
  return { tenantId: tenantOf(ctx), userId: ctx.userId };
}

export const inviteRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new InviteService({ db: deps.db, clock: deps.clock, cpfHashKey: deps.inviteCpfHashKey });
  const admin = app.authorize('admin');

  app.get(
    '/invites',
    { preHandler: [admin], schema: { tags, summary: 'Lista os convites da conta', response: { 200: inviteListResponse } } },
    async (req) => ({ data: await service.list(actorOf(req.ctx!).tenantId) }),
  );

  app.post(
    '/invites',
    {
      preHandler: [admin],
      schema: { tags, summary: 'Convida um admin ou rh; o token do link sai só nesta resposta', body: createInviteBody, response: { 201: createdInviteResponse } },
    },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return reply.code(201).send({ data: await service.create(actorOf(req.ctx!), req.body) });
    },
  );

  app.post(
    '/invites/:inviteId/revoke',
    { preHandler: [admin], schema: { tags, summary: 'Revoga um convite pendente', params: inviteIdParams, response: { 200: inviteResponse } } },
    async (req) => ({ data: await service.revoke(actorOf(req.ctx!), req.params.inviteId) }),
  );

  await app.register(publicInviteRoutes, { ...deps, service });
};
