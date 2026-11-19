/**
 * Tratamento central de erros: `{ error (pt-BR), code }`. Nunca devolve stack,
 * SQL ou texto de exceção ao cliente; o detalhe vai só para o log.
 */
import {
  EngineIntegrityError,
  EngineProtocolError,
  errorResponseSchema,
  type ErrorCode,
  type ErrorResponse,
} from '@genus/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

/** Erro esperado, com status e código já decididos. */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

function body(code: ErrorCode, error: string, details?: ErrorResponse['details']): ErrorResponse {
  return errorResponseSchema.parse(details ? { error, code, details } : { error, code });
}

/** Só nome, mensagem, código e stack: `detail` de erros do pg pode conter valores (CPF). */
function describe(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return {
      name: err.name,
      message: err.message,
      code: typeof code === 'string' ? code : undefined,
      stack: err.stack,
    };
  }
  return { name: 'NonError' };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    return reply.code(404).send(body('NOT_FOUND', 'Recurso não encontrado'));
  });

  app.setErrorHandler((err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send(body(err.code, err.message, err.details));
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.code(400).send(
        body(
          'VALIDATION_ERROR',
          'Requisição inválida',
          err.validation.map((v) => ({
            path: v.instancePath.replace(/^\//, ''),
            message: v.message ?? 'inválido',
          })),
        ),
      );
    }

    if (err instanceof EngineIntegrityError || err instanceof EngineProtocolError) {
      req.log.error(
        { severity: err instanceof EngineIntegrityError ? 'critical' : 'high', err: describe(err) },
        'falha de integração com a engine',
      );
      return reply.code(500).send(body('INTERNAL_ERROR', 'Erro interno'));
    }

    const status = (err as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const code = (err as FastifyError).code;
      if (status === 413 && (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_ERR_CTP_BODY_TOO_LARGE')) {
        return reply.code(413).send(body('IMAGE_TOO_LARGE', 'Imagem maior que o limite permitido'));
      }
      if (status === 404) return reply.code(404).send(body('NOT_FOUND', 'Recurso não encontrado'));
      return reply.code(400).send(body('VALIDATION_ERROR', 'Requisição inválida'));
    }

    req.log.error({ err: describe(err) }, 'erro inesperado');
    return reply.code(500).send(body('INTERNAL_ERROR', 'Erro interno'));
  });
}
