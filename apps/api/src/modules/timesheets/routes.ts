/**
 * Apuração (G4), sob /portal. Recalcular: só rh. Consultar: rh, admin e
 * gestor (equipe, se ligado). O colaborador consulta a própria em /portal/me/timesheets.
 * `/timesheets` é o dia de todos do estabelecimento; `/employees/:id/timesheets`, o período de um.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import { EstablishmentDayService } from './establishment-day';
import {
  dayRowsQuery,
  dayRowsResponse,
  periodQuery,
  recalculateBody,
  recalculateEstablishmentBody,
  recalculateEstablishmentResponse,
  recalculateResponse,
  timesheetListResponse,
} from './schemas';
import { TimesheetService } from './service';

const tags = ['Apuração'];

export const timesheetRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new TimesheetService(deps);
  const establishmentDay = new EstablishmentDayService(deps);

  app.get(
    '/timesheets',
    {
      preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'gestor'))],
      schema: { tags, summary: 'Apuração do dia dos colaboradores do estabelecimento', querystring: dayRowsQuery, response: { 200: dayRowsResponse } },
    },
    async (req) => establishmentDay.list(req.ctx!, req.query),
  );

  app.post(
    '/timesheets/recalculate',
    {
      preHandler: [app.authorize('rh')],
      schema: {
        tags,
        summary: 'Recalcula o dia de todos os colaboradores do estabelecimento',
        body: recalculateEstablishmentBody,
        response: { 200: recalculateEstablishmentResponse },
      },
    },
    async (req) => ({ data: await establishmentDay.recalculate(req.ctx!, req.body) }),
  );

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
