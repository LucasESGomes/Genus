import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { growthQuery, growthResponse, statsOverviewResponse, tenantIdParams, tenantStatsResponse, windowQuery } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { StatsService } from './service';

const tags = ['Super admin: estatísticas'];

export const statsRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new StatsService(deps);

  app.get(
    '/stats/overview',
    { schema: { tags, summary: 'Visão geral da plataforma (só agregados)', querystring: windowQuery, response: { 200: statsOverviewResponse } } },
    async (req) => ({ data: await service.overview(req.query.window) }),
  );

  app.get(
    '/stats/tenants/:tenantId',
    {
      schema: {
        tags,
        summary: 'Estatísticas de uma conta (auditada como leitura sensível)',
        params: tenantIdParams,
        querystring: windowQuery,
        response: { 200: tenantStatsResponse },
      },
    },
    async (req) => ({ data: await service.tenant(req.ctx!, req.params.tenantId, req.query.window) }),
  );

  app.get(
    '/stats/growth',
    { schema: { tags, summary: 'Crescimento mensal de contas e colaboradores', querystring: growthQuery, response: { 200: growthResponse } } },
    async (req) => ({ data: await service.growth(req.query.months) }),
  );
};
