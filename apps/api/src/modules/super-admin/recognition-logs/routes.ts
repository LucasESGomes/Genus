/** Reconhecimento facial (só agregados), sob /portal/super-admin. A guarda do papel está no escopo (../routes.ts). */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { recognitionDevicesResponse, recognitionQuery, recognitionSeriesQuery, recognitionSeriesResponse, recognitionSummaryResponse } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { RecognitionService } from './service';

const tags = ['Super admin: reconhecimento'];

export const recognitionRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new RecognitionService(deps);

  app.get(
    '/recognition/summary',
    { schema: { tags, summary: 'Resumo agregado do reconhecimento na janela (cache de 60 s)', querystring: recognitionQuery, response: { 200: recognitionSummaryResponse } } },
    async (req) => ({ data: await service.summary(req.ctx!, req.query) }),
  );
  app.get(
    '/recognition/series',
    { schema: { tags, summary: 'Série de batidas por hora ou dia', querystring: recognitionSeriesQuery, response: { 200: recognitionSeriesResponse } } },
    async (req) => ({ data: await service.series(req.ctx!, req.query) }),
  );
  app.get(
    '/recognition/devices',
    { schema: { tags, summary: 'Agregado por aparelho', querystring: recognitionQuery, response: { 200: recognitionDevicesResponse } } },
    async (req) => ({ data: await service.devices(req.ctx!, req.query) }),
  );
};
