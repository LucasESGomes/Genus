/**
 * Cadastro facial no totem (RF04), sob /portal. Perfis: rh e admin (a sessão do
 * totem). O colaborador se identifica com CPF + PIN; o front conduz os passos.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PortalDeps } from '../portal/deps';
import { enrollmentResponse, FacialEnrollmentService, facialStatusBody, facialStatusResponse } from './enrollment';

const tags = ['Biometria facial'];

export const facialRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new FacialEnrollmentService(deps);
  const kiosk = app.authorize('rh', 'admin');

  app.post(
    '/facial/enrollments',
    {
      preHandler: [kiosk],
      schema: {
        tags,
        summary: 'Cadastra o rosto (multipart: cpf, pin, consentAccepted, consentTextVersion e 1 a 5 fotos em photos)',
        consumes: ['multipart/form-data'],
        response: { 201: enrollmentResponse },
      },
    },
    async (req, reply) => reply.code(201).send({ data: await service.enroll(req.ctx!, req) }),
  );

  // POST, não GET: o CPF vai no corpo para não cair em log de URL (api e nginx)
  app.post(
    '/facial/status',
    { preHandler: [kiosk], schema: { tags, summary: 'Diz se o colaborador já tem rosto cadastrado', body: facialStatusBody, response: { 200: facialStatusResponse } } },
    async (req) => ({ data: await service.status(req.ctx!, req.body.cpf) }),
  );
};
