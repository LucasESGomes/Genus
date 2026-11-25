/**
 * `buildApp(deps)`: monta o Fastify sem abrir porta (os testes usam `inject`).
 */
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import type { Clock, Logger } from '@genus/shared';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Pool } from 'pg';
import type { Database } from './db/client';
import type { Auth } from './modules/auth/auth';
import { meRoutes } from './modules/auth/me-routes';
import { authRoutes } from './modules/auth/routes';
import { healthRoutes } from './modules/health/routes';
import type { PortalDeps } from './modules/portal/deps';
import { portalRoutes } from './modules/portal/routes';
import { registerApiDocs } from './plugins/api-docs';
import { registerDeviceAuth } from './plugins/device-auth';
import { registerErrorHandling } from './plugins/error-handler';
import { registerRequestContext } from './plugins/request-context';

export interface AppDeps {
  logger: Logger;
  pool: Pick<Pool, 'query'>;
  /** Drizzle sobre o pool; os services dos módulos recebem os repositórios montados no container. */
  db: Database;
  corsOrigins: string[];
  /** Swagger em /docs. Só true com APP_ENV=dev; mesmo assim só atende 127.0.0.1/::1. */
  apiDocs?: boolean;
  /** Login (Better Auth). Sem ele, só /health responde (testes de health). */
  auth?: { auth: Auth; baseURL: string; clock: Clock };
  /** Módulos do portal de RH (/portal/*). Exigem `auth`. */
  portal?: PortalDeps;
}

/**
 * O log de requisição do Fastify traz a URL: `?q=` (busca por nome) é dado pessoal, e o header
 * `X-Device-Key` é credencial. O serializador grava só método, caminho (sem query) e IP; nenhum header.
 */
export function serializeRequest(req: { method?: string; url?: string; ip?: string }) {
  const url = req.url ?? '';
  const at = url.indexOf('?');
  return { method: req.method, url: at === -1 ? url : url.slice(0, at), remoteAddress: req.ip };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const logger = deps.logger.child({}, { serializers: { req: serializeRequest } });
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });
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

  if (deps.auth) {
    // req.ctx + app.authenticate/authorize; depois /auth/* (Better Auth) e /me.
    registerRequestContext(app, { auth: deps.auth.auth, db: deps.db, clock: deps.auth.clock });
    await app.register(authRoutes, { auth: deps.auth.auth, baseURL: deps.auth.baseURL });
    await app.register(meRoutes, { db: deps.db });
  }

  // Os módulos do portal (src/modules/<nome>/routes.ts) entram aqui, sob o prefixo /portal.
  if (deps.auth && deps.portal) {
    // Upload de atestado e das fotos do cadastro facial. Arquivo acima do limite: 413.
    await app.register(multipart, {
      // files: um a mais que o máximo de fotos, para a 6ª chegar à validação e virar 400
      limits: { fileSize: deps.portal.maxAttachmentBytes, files: 6, fields: 10, fieldSize: 256, fieldNameSize: 64, parts: 16 },
    });
    const portal = deps.portal;
    // Totem: `X-Device-Key` → `req.device` (rotas /portal/totem/*). Chave inválida: 401, sem diferenciar o motivo.
    registerDeviceAuth(app, { db: deps.db, clock: portal.clock });
    // O prefixo fica no escopo de fora: as opções dos módulos são só as dependências.
    await app.register(async (scope) => scope.register(portalRoutes, portal), { prefix: '/portal' });
  }

  return app;
}
