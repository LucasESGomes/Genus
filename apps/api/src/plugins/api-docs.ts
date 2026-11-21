/**
 * Documentação OpenAPI (Swagger) da api do portal.
 *
 * NÃO é pública: só é registrada com APP_ENV=dev e, mesmo em dev, só responde a
 * quem chama da própria máquina (127.0.0.1 / ::1). No contêiner, a porta é
 * publicada em 127.0.0.1 do host, mas o IP que chega é o da rede do Docker:
 * por isso a UI fica fechada lá e só abre com `pnpm --filter @genus/api dev`.
 *
 *   UI:   http://localhost:3002/docs
 *   JSON: http://localhost:3002/docs/json
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { HttpError } from './error-handler';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const DOCS_PREFIX = '/docs';

export async function registerApiDocs(app: FastifyInstance): Promise<void> {
  const onlyLocal = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!LOOPBACK.has(req.ip)) throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada');
  };

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Genus · API do portal de RH',
        version: '0.1.0',
        description: 'Cadastros, jornada, apuração, ausências, banco de horas, férias e fechamento (banco `app`, schema `rh`).',
      },
      servers: [{ url: 'http://localhost:3002', description: 'dev local' }],
      tags: [{ name: 'Saúde', description: 'Estado da api e do banco' }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: DOCS_PREFIX,
    uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: false },
    uiHooks: { onRequest: onlyLocal },
    staticCSP: true,
  });
}
