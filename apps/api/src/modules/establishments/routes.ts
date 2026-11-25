/**
 * `GET /portal/establishments` (docs/prompts/mvp-superadmin-orquestracao.md): lista curta para os
 * seletores. Criar e alterar estabelecimento é do super_admin (super-admin/organization).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PortalDeps } from '../portal/deps';
import { establishmentOptionListResponse } from './schemas';
import { EstablishmentService } from './service';

const tags = ['Estabelecimentos'];

export const establishmentRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new EstablishmentService(deps);
  const readers = app.authorize(...deps.access.roles('admin', 'rh', 'gestor', 'contador', 'colaborador'));

  app.get(
    '/establishments',
    { preHandler: [readers], schema: { tags, summary: 'Estabelecimentos no escopo do usuário', response: { 200: establishmentOptionListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!) }),
  );
};
