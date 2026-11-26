/** Visão geral (G11), sob /portal. Leitura: rh, admin e gestor (se ligado; só a própria equipe). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PortalDeps } from '../portal/deps';
import { overviewQuery, overviewResponse } from './schemas';
import { OverviewService } from './service';

export const overviewRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new OverviewService(deps);
  app.get(
    '/overview',
    {
      preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'gestor'))],
      schema: { tags: ['Visão geral'], summary: 'KPIs, série diária, situação dos dias, top horas extras e alertas do estabelecimento', querystring: overviewQuery, response: { 200: overviewResponse } },
    },
    async (req) => ({ data: await service.get(req.ctx!, req.query) }),
  );
};
