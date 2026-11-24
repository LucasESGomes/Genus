/** Afastamentos (G7), sob /portal. Registrar: rh. Consultar: rh, admin, gestor (equipe, se ligado). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import { absenceListResponse, absenceResponse, createAbsenceBody } from './schemas';
import { AbsenceService } from './service';

const tags = ['Afastamentos'];

export const absenceRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new AbsenceService(deps);

  app.post(
    '/employees/:id/absences',
    { preHandler: [app.authorize('rh')], schema: { tags, params: idParams, body: createAbsenceBody, response: { 201: absenceResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.params.id, req.body) }),
  );

  app.get(
    '/employees/:id/absences',
    { preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'gestor'))], schema: { tags, params: idParams, response: { 200: absenceListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.params.id) }),
  );
};
