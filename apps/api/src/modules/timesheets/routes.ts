/**
 * Apuração (G4), sob /portal. Recalcular: só rh. Consultar: rh, admin e
 * gestor (equipe, se ligado). O colaborador consulta a própria em /portal/me/timesheets.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import { periodQuery, recalculateBody, recalculateResponse, timesheetListResponse } from './schemas';
import { TimesheetService } from './service';

const tags = ['Apuração'];

export const timesheetRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new TimesheetService(deps);

  app.post(
    '/employees/:id/timesheets/recalculate',
    {
      preHandler: [app.authorize('rh')],
      schema: { tags, summary: 'Recalcula a apuração dos dias (lê as batidas do arp)', params: idParams, body: recalculateBody, response: { 200: recalculateResponse } },
    },
    async (req) => ({ data: await service.recalculate(req.ctx!, req.params.id, req.body.from, req.body.to) }),
  );

  app.get(
    '/employees/:id/timesheets',
    {
      preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'gestor'))],
      schema: { tags, summary: 'Apuração do colaborador no período', params: idParams, querystring: periodQuery, response: { 200: timesheetListResponse } },
    },
    async (req) => ({ data: await service.list(req.ctx!, req.params.id, req.query.from, req.query.to) }),
  );
};
