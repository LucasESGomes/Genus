/**
 * `buildApp(deps)`: monta o Fastify sem abrir porta (os testes usam `inject`).
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { Logger } from '@genus/shared';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Pool } from 'pg';
import type { Database } from './db/client';
import { healthRoutes } from './modules/health/routes';
import { registerApiDocs } from './plugins/api-docs';
import { registerErrorHandling } from './plugins/error-handler';

export interface AppDeps {
  logger: Logger;
  pool: Pick<Pool, 'query'>;
  /** Drizzle sobre o pool; os services dos módulos recebem os repositórios montados no container. */
  db: Database;
  corsOrigins: string[];
  /** Swagger em /docs. Só true com APP_ENV=dev; mesmo assim só atende 127.0.0.1/::1. */
  apiDocs?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: deps.logger as FastifyBaseLogger });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // A CSP padrão do helmet bloquearia a UI do Swagger; ela traz a própria (staticCSP).
  await app.register(helmet, { contentSecurityPolicy: false });
  if (deps.corsOrigins.length > 0) {
    await app.register(cors, { origin: deps.corsOrigins, credentials: true });
  }

  // Antes das rotas: o @fastify/swagger coleta as rotas registradas depois dele.
  if (deps.apiDocs) await registerApiDocs(app);

  await app.register(healthRoutes, { pool: deps.pool });

  // Os módulos do portal (src/modules/<nome>/routes.ts) entram aqui, sob o prefixo /portal.

  return app;
}
