/**
 * Documentação OpenAPI (Swagger) da api do coletor.
 *
 * NÃO é pública: só é registrada com APP_ENV=dev (homolog e prod nem montam as
 * rotas) e, mesmo em dev, só responde a quem chama da própria máquina
 * (127.0.0.1 / ::1). Fora disso, 404 como qualquer rota inexistente.
 *
 *   UI:   http://localhost:3001/docs
 *   JSON: http://localhost:3001/docs/json
 */
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ACCEPTED_IMAGE_MIMES, FALLBACK_REASONS, PUNCH_WARNINGS, errorResponseSchema } from '@genus/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { HttpError } from './error-handler';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const DOCS_PREFIX = '/docs';

/** Corpo multipart de POST /coletor/batidas (validado à mão na rota; aqui só documentado). */
const punchMultipartBody = {
  type: 'object',
  required: ['image', 'deviceSequence', 'capturedAt'],
  properties: {
    image: {
      type: 'string',
      format: 'binary',
      description: `Foto do rosto (${ACCEPTED_IMAGE_MIMES.join(' ou ')}). O mime declarado e os primeiros bytes precisam bater. Máximo: MAX_IMAGE_BYTES (padrão 1 MB).`,
    },
    deviceSequence: {
      type: 'integer',
      minimum: 1,
      description: 'Sequência local do aparelho (> 0). Mesma sequência no mesmo aparelho = mesma batida (idempotência).',
      example: 812,
    },
    capturedAt: {
      type: 'string',
      format: 'date-time',
      description: 'Hora da captura no aparelho, ISO 8601 com fuso. Se divergir mais de 30 s do servidor (ou estiver no futuro), vale a hora do servidor e sai o aviso clock_divergence.',
      example: '2026-11-20T11:00:00.000Z',
    },
  },
};

const errorJsonSchema = z.toJSONSchema(errorResponseSchema, { target: 'draft-7' });

function errorResponse(description: string, example: { error: string; code: string }) {
  return { description, content: { 'application/json': { schema: errorJsonSchema, example } } };
}

export async function registerApiDocs(app: FastifyInstance): Promise<void> {
  // Mesmo em dev, a documentação só atende a própria máquina.
  const onlyLocal = async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!LOOPBACK.has(req.ip)) throw new HttpError(404, 'NOT_FOUND', 'Rota não encontrada');
  };

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Genus · API do coletor',
        version: '0.1.0',
        description: [
          'Recebe a foto do aparelho, reconhece o rosto na engine e grava a batida em `arp.entradas` (`pendente`).',
          '',
          '**Regras:** o sistema nunca bloqueia uma marcação. Rosto não reconhecido, engine fora, lenta ou degradada respondem **200** com `outcome: "fallback_required"` (o aparelho pede PIN). Duplicidade e hora divergente só geram avisos (`warnings`); a batida é registrada.',
          '',
          `**Motivos de fallback:** ${FALLBACK_REASONS.map((r) => `\`${r}\``).join(', ')}.`,
          `**Avisos:** ${PUNCH_WARNINGS.map((w) => `\`${w}\``).join(', ')}.`,
          '',
          'Toda resposta de batida traz o header `Server-Timing` (validate, candidates, engine, engine-processing, db, total). `meta.timings` só aparece com `EXPOSE_TIMINGS=true`.',
          '',
          'Esta documentação só existe com `APP_ENV=dev` e só responde a chamadas da própria máquina.',
        ].join('\n'),
      },
      servers: [{ url: 'http://localhost:3001', description: 'dev local' }],
      tags: [
        { name: 'Batidas', description: 'Registro de ponto pelo coletor' },
        { name: 'Saúde', description: 'Estado da api e das dependências (sem chave)' },
      ],
      components: {
        securitySchemes: {
          serviceKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Service-Key',
            description: 'Chave de serviço (uma das COLLECTOR_SERVICE_KEYS). Provisória: será trocada por certificado mTLS do aparelho.',
          },
          deviceKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-Device-Key',
            description: 'Chave do aparelho (totem web), gerada no painel de RH. Só nas rotas /coletor/totem/*.',
          },
        },
      },
    },
    transform: (input) => {
      const out = jsonSchemaTransform(input);
      if ((input.url === '/coletor/batidas' || input.url === '/coletor/totem/batidas') && input.route.method === 'POST') {
        const schema = out.schema as Record<string, unknown>;
        schema.consumes = ['multipart/form-data'];
        schema.body = punchMultipartBody;
      }
      return out;
    },
    transformObject: (doc) => {
      if (!('openapiObject' in doc)) return doc.swaggerObject;
      const api = doc.openapiObject;
      const op = api.paths?.['/coletor/batidas']?.post;
      if (op?.responses) {
        Object.assign(op.responses, {
          400: errorResponse('Validação: imagem sem mime/magic bytes aceitos (`INVALID_IMAGE`), sem imagem, `deviceSequence` ou `capturedAt` inválidos (`VALIDATION_ERROR`)', {
            error: 'deviceSequence deve ser maior que zero',
            code: 'VALIDATION_ERROR',
          }),
          401: errorResponse('Sem `X-Service-Key` ou chave inválida (mesma resposta nos dois casos)', { error: 'Não autorizado', code: 'UNAUTHORIZED' }),
          413: errorResponse('Imagem maior que MAX_IMAGE_BYTES', { error: 'Imagem maior que o limite', code: 'IMAGE_TOO_LARGE' }),
          500: errorResponse('Erro interno (ex.: falha de integridade criptográfica na engine, banco fora). Nunca traz detalhe interno', {
            error: 'Erro interno',
            code: 'INTERNAL_ERROR',
          }),
        });
      }
      return api;
    },
  });

  await app.register(swaggerUi, {
    routePrefix: DOCS_PREFIX,
    uiConfig: { docExpansion: 'list', deepLinking: true, persistAuthorization: false },
    uiHooks: { onRequest: onlyLocal },
    staticCSP: true,
  });
}
