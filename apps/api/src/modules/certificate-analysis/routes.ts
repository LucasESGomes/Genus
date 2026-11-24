/**
 * Análise de atestado (G6), sob /portal. Só o RH (admin e gestor → 403).
 *   POST /certificates/:id/analyze   dispara a análise de um atestado pendente
 *   GET  /certificates/:id/analyses  análises já feitas (CID e evidências decifrados, leitura auditada)
 *
 * 400 entrada inválida · 403 sem permissão · 404 fora do escopo · 409 atestado já decidido.
 * Falha da IA não vira 500: a análise das regras volta com `ai.status = 'falhou'`.
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../http/schemas';
import type { PortalDeps } from '../portal/deps';
import { analyzeCertificateBody, analyzeCertificateResponse, listAnalysesResponse } from './schemas';
import { CertificateAnalysisService } from './service';

const tags = ['Atestados'];

export const certificateAnalysisRoutes: FastifyPluginAsyncZod<PortalDeps> = async (app, deps) => {
  const service = new CertificateAnalysisService({
    db: deps.db,
    clock: deps.clock,
    ai: deps.certificateAi.registry,
    healthCipher: deps.certificateAi.healthCipher,
    logger: app.log,
  });
  const rh = app.authorize('rh');

  app.post(
    '/certificates/:id/analyze',
    {
      preHandler: [rh],
      schema: {
        tags,
        summary: 'Analisa o atestado (regras + IA). Só sugere: o status não muda',
        params: idParams,
        body: analyzeCertificateBody,
        response: { 200: analyzeCertificateResponse },
      },
    },
    async (req) => ({ data: await service.analyze(req.ctx!, req.params.id, req.body) }),
  );

  app.get(
    '/certificates/:id/analyses',
    { preHandler: [rh], schema: { tags, summary: 'Análises do atestado (leitura auditada)', params: idParams, response: { 200: listAnalysesResponse } } },
    async (req) => ({ data: await service.list(req.ctx!, req.params.id) }),
  );
};
