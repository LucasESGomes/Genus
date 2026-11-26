/**
 * Rotas do totem web, sob /portal/totem. Autenticação por `X-Device-Key` (sem sessão de usuário):
 * o `tenantId` e o estabelecimento vêm do aparelho. docs/totem-contrato.md §3.2.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PortalDeps } from '../portal/deps';
import { FacialEnrollmentService, identityBody, identityResponse } from '../facial/enrollment';
import { sanitizeAppVersion, TotemService } from './service';

const tags = ['Totem'];

const contextResponse = z.object({
  data: z.object({
    device: z.object({ id: z.number(), name: z.string() }),
    establishment: z.object({ id: z.number(), name: z.string() }),
    calibration: z.object({ sessionId: z.number(), status: z.literal('aguardando') }).nullable(),
    serverTime: z.string(),
  }),
});
const enrollmentResponse = z.object({ data: z.object({ enrolledAt: z.string(), imagesProcessed: z.number() }) });
const calibrationResponse = z.object({ data: z.object({ status: z.enum(['calculada', 'falhou']) }) });

export const totemRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new TotemService({ ...deps, enrollment: new FacialEnrollmentService(deps) });
  const auth = app.authenticateDevice;

  app.get(
    '/totem/context',
    { preHandler: [auth], schema: { tags, summary: 'Contexto do aparelho (e da calibração à espera); registra a conexão', response: { 200: contextResponse } } },
    async (req) => ({ data: await service.context(req.device!, sanitizeAppVersion(req.headers['x-totem-version'])) }),
  );

  app.post(
    '/totem/facial/identity',
    {
      preHandler: [auth],
      schema: { tags, summary: 'Confere CPF e PIN antes das fotos (mesmo limite de tentativas do cadastro)', body: identityBody, response: { 200: identityResponse } },
    },
    async (req) => ({ data: await service.identify(req.device!, req.ip, req.body) }),
  );

  app.post(
    '/totem/facial/enrollments',
    {
      preHandler: [auth],
      schema: {
        tags,
        summary: 'Cadastra o rosto (multipart: cpf, pin, consentAccepted, consentTextVersion e 1 a 5 fotos em photos)',
        consumes: ['multipart/form-data'],
        response: { 201: enrollmentResponse },
      },
    },
    async (req, reply) => reply.code(201).send({ data: await service.enroll(req.device!, req) }),
  );

  app.post(
    '/totem/calibration',
    {
      preHandler: [auth],
      schema: {
        tags,
        summary: 'Envia as fotos da calibração (multipart: sessionId, genuine p1_1.jpg..., impostor, attack); as fotos não são guardadas',
        consumes: ['multipart/form-data'],
        response: { 200: calibrationResponse },
      },
    },
    async (req) => ({ data: await service.submitCalibration(req.device!, req) }),
  );
};
