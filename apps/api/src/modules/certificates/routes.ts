/**
 * Atestados (G7), sob /portal.
 *   listar: rh (com médico e arquivo), admin e gestor da equipe (sem diagnóstico);
 *   arquivo, aprovar, recusar: só rh (admin → 403);
 *   enviar e acompanhar: o próprio colaborador (/me/certificates).
 * Nenhuma rota devolve CID.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import {
  certificateListResponse,
  certificateRhResponse,
  listCertificatesQuery,
  myCertificateListResponse,
  myCertificateResponse,
  rejectCertificateBody,
} from './schemas';
import { CertificateService } from './service';

const tags = ['Atestados'];

export const certificateRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new CertificateService(deps);
  const rh = app.authorize('rh');

  app.get(
    '/certificates',
    { preHandler: [app.authorize(...deps.access.roles('rh', 'admin', 'gestor'))], schema: { tags, querystring: listCertificatesQuery, response: { 200: certificateListResponse } } },
    async (req) => service.list(req.ctx!, req.query),
  );

  app.get(
    '/certificates/:id/file',
    { preHandler: [rh], schema: { tags, summary: 'Arquivo do atestado (download auditado)', params: idParams } },
    async (req, reply) => {
      const file = await service.file(req.ctx!, req.params.id, req.ip);
      return reply
        .header('content-type', file.mime)
        .header('cache-control', 'no-store')
        .header('content-disposition', `attachment; filename="atestado-${req.params.id}"`)
        .send(file.data);
    },
  );

  app.post(
    '/certificates/:id/approve',
    { preHandler: [rh], schema: { tags, params: idParams, response: { 200: certificateRhResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, { approve: true }) }),
  );

  app.post(
    '/certificates/:id/reject',
    { preHandler: [rh], schema: { tags, params: idParams, body: rejectCertificateBody, response: { 200: certificateRhResponse } } },
    async (req) => ({ data: await service.decide(req.ctx!, req.params.id, { approve: false, reason: req.body.reason }) }),
  );

  const self = app.authorize('colaborador');
  const meTags = ['Portal do colaborador'];

  app.get(
    '/me/certificates',
    { preHandler: [self], schema: { tags: meTags, response: { 200: myCertificateListResponse } } },
    async (req) => ({ data: await service.listMine(req.ctx!) }),
  );

  app.post(
    '/me/certificates',
    {
      preHandler: [self],
      schema: { tags: meTags, summary: 'Envia o atestado (multipart: file + startDate + days ou hours)', consumes: ['multipart/form-data'], response: { 201: myCertificateResponse } },
    },
    async (req, reply) => reply.code(201).send({ data: await service.submit(req.ctx!, req) }),
  );
};
