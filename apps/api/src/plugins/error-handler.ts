/**
 * Tratamento central de erros: `{ error (pt-BR), code }`. Nunca devolve stack,
 * SQL ou texto de exceção ao cliente; o detalhe vai só para o log.
 *
 * Boa parte das regras do RH mora no banco (CHECK, EXCLUDE, triggers). O erro do
 * Postgres vira 409/422 com o nome da constraint no log; a mensagem ao cliente
 * é genérica até o módulo traduzir a constraint para uma frase própria.
 */
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { errorResponseSchema, type ErrorCode, type ErrorResponse } from '../http/contracts';
import { domainErrorStatus, mapDatabaseRule } from '../http/domain-errors';
import { RhDomainError } from '../modules/rules-common/rules/errors';

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

/** SQLSTATE do Postgres → resposta. */
const PG_ERRORS: Record<string, { status: number; code: ErrorCode; message: string }> = {
  '23505': { status: 409, code: 'CONFLICT', message: 'Já existe um registro com esses dados' },
  '23P01': { status: 409, code: 'CONFLICT', message: 'O período se sobrepõe a outro já cadastrado' },
  '23514': { status: 422, code: 'BUSINESS_RULE_VIOLATION', message: 'A operação viola uma regra de negócio' },
  '23503': { status: 422, code: 'BUSINESS_RULE_VIOLATION', message: 'Registro relacionado não encontrado ou em uso' },
  '23502': { status: 422, code: 'BUSINESS_RULE_VIOLATION', message: 'Campo obrigatório ausente' },
};

export function pgError(err: unknown): { sqlState: string; constraint?: string; message: string } | undefined {
  const e = err as { code?: unknown; constraint?: unknown; severity?: unknown; cause?: unknown; message?: unknown };
  // O Drizzle embrulha o erro do driver em `cause`.
  if (typeof e.code === 'string' && typeof e.severity === 'string') {
    return {
      sqlState: e.code,
      constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
      message: typeof e.message === 'string' ? e.message : '',
    };
  }
  return e.cause ? pgError(e.cause) : undefined;
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

    if (err instanceof RhDomainError) {
      // A mensagem das regras puras nunca leva CPF, CID nem salário (rules-common/rules/errors.ts).
      return reply.code(domainErrorStatus(err.code)).send(body(err.code, err.message));
    }

    const pg = pgError(err);
    // Regra conhecida (EXCLUDE, UNIQUE, trigger) → código de domínio; senão, o genérico do SQLSTATE.
    const mapped = pg ? (mapDatabaseRule(pg.constraint, pg.message) ?? PG_ERRORS[pg.sqlState]) : undefined;
    if (pg && mapped) {
      req.log.warn({ sqlState: pg.sqlState, constraint: pg.constraint, code: mapped.code }, 'regra do banco recusou a operação');
      return reply.code(mapped.status).send(body(mapped.code, mapped.message));
    }

    const status = (err as FastifyError).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 404) return reply.code(404).send(body('NOT_FOUND', 'Recurso não encontrado'));
      if (status === 413) return reply.code(413).send(body('ARQUIVO_INVALIDO', 'Arquivo maior que o permitido'));
      return reply.code(400).send(body('VALIDATION_ERROR', 'Requisição inválida'));
    }

    req.log.error({ err: describe(err) }, 'erro inesperado');
    return reply.code(500).send(body('INTERNAL_ERROR', 'Erro interno'));
  });
}
