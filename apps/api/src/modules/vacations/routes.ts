/**
 * Férias (G9), sob /portal.
 *   período aquisitivo: abrir rh; consultar rh, admin, gestor (equipe, se ligado);
 *   pedir: rh (por um colaborador) e o próprio colaborador (/me/vacations);
 *   aprovar e recusar: rh; gestor (equipe, se ligado); cancelar: rh.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../../plugins/error-handler';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  accrualPeriodListResponse,
  accrualPeriodResponse,
  createAccrualPeriodBody,
  rejectVacationBody,
  requestVacationBody,
  vacationResponse,
} from './schemas';
import { VacationService } from './service';

const tags = ['Férias'];

export const vacationRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new VacationService(deps);
  const rh = app.authorize('rh');
  const deciders = app.authorize(...deps.access.roles('rh', 'gestor'));
  const self = app.authorize('colaborador');

  app.post(
    '/employees/:id/vacation-periods',
    { preHandler: [rh], schema: { tags, params: idParams, body: createAccrualPeriodBody, response: { 201: accrualPeriodResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.createAccrualPeriod(req.ctx!, req.params.id, req.body) }),
  );

  app.get(
    '/employees/:id/vacation-periods',
    { preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'gestor'))], schema: { tags, params: idParams, response: { 200: accrualPeriodListResponse } } },
    async (req) => ({ data: await service.listPeriods(req.ctx!, req.params.id) }),
  );

  app.post(
    '/employees/:id/vacations',
    { preHandler: [rh], schema: { tags, params: idParams, body: requestVacationBody, response: { 201: vacationResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.request(req.ctx!, req.params.id, req.body) }),
  );

  app.get(
    '/me/vacations',
    { preHandler: [self], schema: { tags: ['Portal do colaborador'], response: { 200: accrualPeriodListResponse } } },
    async (req) => ({ data: await service.listPeriods(req.ctx!, selfId(req.ctx!)) }),
  );

  app.post(
    '/me/vacations',
    { preHandler: [self], schema: { tags: ['Portal do colaborador'], body: requestVacationBody, response: { 201: vacationResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.request(req.ctx!, selfId(req.ctx!), req.body) }),
  );

  app.post(
    '/vacations/:id/approve',
    { preHandler: [deciders], schema: { tags, params: idParams, response: { 200: vacationResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, 'approve') }),
  );

  app.post(
    '/vacations/:id/reject',
    { preHandler: [deciders], schema: { tags, params: idParams, body: rejectVacationBody, response: { 200: vacationResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, 'reject', req.body.reason) }),
  );

  app.post(
    '/vacations/:id/cancel',
    { preHandler: [rh], schema: { tags, params: idParams, body: rejectVacationBody, response: { 200: vacationResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, 'cancel', req.body.reason) }),
  );
};

function selfId(ctx: { employeeId: number | null }): number {
  if (ctx.employeeId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
  return ctx.employeeId;
}
