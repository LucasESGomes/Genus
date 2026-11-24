/**
 * Ajustes de marcação (G5), sob /portal.
 *   pedir: rh (por um colaborador) e o próprio colaborador (/me/adjustments);
 *   listar e decidir: rh; gestor da equipe, se ligado (abono só o RH);
 *   admin não decide ajuste (04 §7.1).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { HttpError } from '../../plugins/error-handler';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import { adjustmentListResponse, adjustmentResponse, approveBody, createAdjustmentBody, listAdjustmentsQuery, rejectBody } from './schemas';
import { AdjustmentService } from './service';

const tags = ['Ajustes'];

export const adjustmentRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new AdjustmentService(deps);
  const deciders = app.authorize(...deps.access.roles('rh', 'gestor'));

  app.post(
    '/employees/:id/adjustments',
    { preHandler: [app.authorize('rh')], schema: { tags, params: idParams, body: createAdjustmentBody, response: { 201: adjustmentResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.params.id, req.body) }),
  );

  app.post(
    '/me/adjustments',
    {
      preHandler: [app.authorize('colaborador')],
      schema: { tags: ['Portal do colaborador'], summary: 'O colaborador pede ajuste da própria marcação', body: createAdjustmentBody, response: { 201: adjustmentResponse } },
    },
    async (req, reply) => {
      const ctx = req.ctx!;
      if (ctx.employeeId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
      // o colaborador vem da sessão; qualquer id no corpo é ignorado
      return reply.code(201).send({ data: await service.create(ctx, ctx.employeeId, req.body) });
    },
  );

  app.get(
    '/adjustments',
    { preHandler: [deciders], schema: { tags, querystring: listAdjustmentsQuery, response: { 200: adjustmentListResponse } } },
    async (req) => service.list(req.ctx!, req.query),
  );

  app.post(
    '/adjustments/:id/approve',
    { preHandler: [deciders], schema: { tags, params: idParams, body: approveBody, response: { 200: adjustmentResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, { approve: true, note: req.body.note }) }),
  );

  app.post(
    '/adjustments/:id/reject',
    { preHandler: [deciders], schema: { tags, params: idParams, body: rejectBody, response: { 200: adjustmentResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, { approve: false, reason: req.body.reason }) }),
  );
};
