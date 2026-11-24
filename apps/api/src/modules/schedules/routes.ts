/**
 * Escalas (G2), sob /portal. Leitura: rh e admin. Escrita: só rh.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  assignScheduleBody,
  createScheduleBody,
  employeeScheduleListResponse,
  employeeScheduleResponse,
  listSchedulesQuery,
  scheduleListResponse,
  scheduleResponse,
  updateScheduleBody,
} from './schemas';
import { ScheduleService } from './service';

const tags = ['Escalas'];

export const scheduleRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new ScheduleService(deps);
  const readers = app.authorize('rh', 'admin');
  const rh = app.authorize('rh');

  app.get(
    '/schedules',
    { preHandler: [readers], schema: { tags, querystring: listSchedulesQuery, response: { 200: scheduleListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.query) }),
  );
  app.get(
    '/schedules/:id',
    { preHandler: [readers], schema: { tags, params: idParams, response: { 200: scheduleResponse } } },
    async (req) => ({ data: await service.get(req.ctx!, req.params.id) }),
  );
  app.post(
    '/schedules',
    { preHandler: [rh], schema: { tags, summary: 'Cadastra escala e dias (avisa se passar do limite semanal)', body: createScheduleBody, response: { 201: scheduleResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.body) }),
  );
  app.patch(
    '/schedules/:id',
    { preHandler: [rh], schema: { tags, params: idParams, body: updateScheduleBody, response: { 200: scheduleResponse } } },
    async (req) => ({ data: await service.update(req.ctx!, req.params.id, req.body) }),
  );
  app.post(
    '/employees/:id/schedules',
    { preHandler: [rh], schema: { tags, summary: 'Liga o colaborador a uma escala, com vigência', params: idParams, body: assignScheduleBody, response: { 201: employeeScheduleResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.assign(req.ctx!, req.params.id, req.body) }),
  );
  app.get(
    '/employees/:id/schedules',
    { preHandler: [readers], schema: { tags, params: idParams, response: { 200: employeeScheduleListResponse } } },
    async (req) => ({ data: await service.listForEmployee(req.ctx!, req.params.id) }),
  );
};
