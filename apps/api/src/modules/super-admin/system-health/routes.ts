import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { systemHealthResponse } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { SystemHealthService } from './service';

const tags = ['Super admin: saúde'];

export const systemHealthRoutes: FastifyPluginAsyncZod<SuperAdminDeps> = async (app, deps) => {
  const service = new SystemHealthService(deps);

  app.get(
    '/system-health',
    {
      schema: {
        tags,
        summary: 'Saúde da plataforma (api, bancos, Valkey, engine, coletor, rep-core e jobs)',
        description: 'Cache de 5 s. `status` é o pior estado entre os checks. Sem URL, credencial nem texto de exceção.',
        response: { 200: systemHealthResponse },
      },
    },
    async () => ({ data: await service.get() }),
  );
};
