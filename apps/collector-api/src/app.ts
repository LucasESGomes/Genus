/**
 * `buildApp(deps)`: monta o Fastify sem abrir porta (os testes usam `inject`).
 */
import multipart from '@fastify/multipart';
import type { DeviceAuthenticator, EngineClient, Logger } from '@genus/shared';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Pool } from 'pg';
import { healthRoutes } from './modules/health/routes';
import { punchRoutes } from './modules/punches/routes';
import type { PunchService } from './modules/punches/service';
import { registerApiDocs } from './plugins/api-docs';
import { registerErrorHandling } from './plugins/error-handler';
import { registerServiceKeyAuth } from './plugins/service-key-auth';

export interface AppDeps {
  logger: Logger;
  pool: Pick<Pool, 'query'>;
  engine: EngineClient;
  punchService: PunchService;
  deviceAuthenticator: DeviceAuthenticator;
  serviceKeys: string[];
  maxImageBytes: number;
  exposeTimings: boolean;
  /** Swagger em /docs. Só true com APP_ENV=dev; mesmo assim só atende 127.0.0.1/::1. */
  apiDocs?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    logController: new LogController({ disableRequestLogging: true }),
    // Um pouco acima do limite da imagem: o multipart é quem recusa com 413.
    bodyLimit: deps.maxImageBytes + 64 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  await app.register(multipart, {
    limits: {
      fileSize: deps.maxImageBytes,
      files: 1,
      fields: 16,
      fieldSize: 256,
      fieldNameSize: 64,
      parts: 20,
    },
  });

  // Antes das rotas: o @fastify/swagger coleta as rotas registradas depois dele.
  if (deps.apiDocs) await registerApiDocs(app);

  await app.register(healthRoutes, { pool: deps.pool, engine: deps.engine });

  await app.register(
    async (scope) => {
      registerServiceKeyAuth(scope, {
        serviceKeys: deps.serviceKeys,
        deviceAuthenticator: deps.deviceAuthenticator,
        logger: deps.logger,
      });
      await scope.register(punchRoutes, { service: deps.punchService, exposeTimings: deps.exposeTimings });
    },
    { prefix: '/coletor' },
  );

  return app;
}
