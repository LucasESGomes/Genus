/**
 * Fechamento e espelho (G10), sob /portal.
 *   listar: rh, admin, contador; abrir, fechar, reabrir e emitir espelhos: rh;
 *   ler o espelho: rh, admin, contador, gestor (equipe, se ligado);
 *   o próprio espelho e a ciência: colaborador (/me/mirrors).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  acknowledgeResponse,
  closingListResponse,
  closingMirrorParams,
  closingResponse,
  createClosingBody,
  generateMirrorsResponse,
  listClosingsQuery,
  mirrorResponse,
  myMirrorListResponse,
  myMirrorParams,
  reopenBody,
} from './schemas';
import { ClosingService } from './service';

const tags = ['Fechamento'];
const meTags = ['Portal do colaborador'];

export const closingRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new ClosingService(deps);
  const rh = app.authorize('rh');
  const self = app.authorize('colaborador');

  app.get(
    '/closings',
    { preHandler: [app.authorize('rh', 'admin', 'contador')], schema: { tags, querystring: listClosingsQuery, response: { 200: closingListResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.query.establishmentId) }),
  );

  app.post(
    '/closings',
    { preHandler: [rh], schema: { tags, summary: 'Abre a competência de um estabelecimento', body: createClosingBody, response: { 201: closingResponse } } },
    async (req, reply) => reply.code(201).send({ data: await service.create(req.ctx!, req.body) }),
  );

  app.post(
    '/closings/:id/close',
    { preHandler: [rh], schema: { tags, params: idParams, response: { 200: closingResponse } } },
    async (req) => ({ data: await service.close(req.ctx!, req.params.id) }),
  );

  app.post(
    '/closings/:id/reopen',
    { preHandler: [rh], schema: { tags, summary: 'Reabre (motivo obrigatório; apaga a ciência dos espelhos)', params: idParams, body: reopenBody, response: { 200: closingResponse } } },
    async (req) => ({ data: await service.reopen(req.ctx!, req.params.id, req.body.reason) }),
  );

  app.post(
    '/closings/:id/mirrors',
    { preHandler: [rh], schema: { tags, summary: 'Emite o espelho de cada colaborador do período', params: idParams, response: { 200: generateMirrorsResponse } } },
    async (req) => ({ data: await service.generateMirrors(req.ctx!, req.params.id) }),
  );

  app.get(
    '/closings/:id/mirrors/:employeeId',
    { preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'contador', 'gestor'))], schema: { tags, params: closingMirrorParams, response: { 200: mirrorResponse } } },
    async (req) => ({ data: await service.mirror(req.ctx!, req.params.id, req.params.employeeId) }),
  );

  app.get('/me/mirrors', { preHandler: [self], schema: { tags: meTags, response: { 200: myMirrorListResponse } } }, async (req) => ({
    data: await service.myMirrors(req.ctx!),
  }));

  app.get(
    '/me/mirrors/:closingId',
    { preHandler: [self], schema: { tags: meTags, params: myMirrorParams, response: { 200: mirrorResponse } } },
    async (req) => ({ data: await service.myMirror(req.ctx!, req.params.closingId) }),
  );

  app.post(
    '/me/mirrors/:closingId/acknowledge',
    { preHandler: [self], schema: { tags: meTags, summary: 'Ciência do espelho (RF48)', params: myMirrorParams, response: { 200: acknowledgeResponse } } },
    async (req) => ({ data: await service.acknowledge(req.ctx!, req.params.closingId, req.ip) }),
  );
};
