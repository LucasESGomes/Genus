/**
 * Logger Pino (JSON) com redação de segredos e dados sensíveis.
 * Nunca logar: CPF completo, embedding, DEK, MASTER_KEY, chave de serviço,
 * chave da engine, imagem. A redação aqui é a segunda barreira; a primeira é
 * não passar esses valores ao logger.
 */
import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

/** Caminhos removidos de qualquer log (inclusive aninhados no objeto `req` do Fastify). */
export const REDACT_PATHS = [
  'req.headers["x-service-key"]',
  'req.headers["x-api-key"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers["x-service-key"]',
  'headers["x-api-key"]',
  'cpf',
  '*.cpf',
  'embedding',
  '*.embedding',
  'embeddingCt',
  '*.embeddingCt',
  'embedding_ct',
  '*.embedding_ct',
  'tenantDek',
  '*.tenantDek',
  'dek',
  '*.dek',
  'dek_ct',
  '*.dek_ct',
  'masterKey',
  '*.masterKey',
  'serviceKey',
  '*.serviceKey',
  'engineApiKey',
  '*.engineApiKey',
  'image',
  '*.image',
] as const;

export interface CreateLoggerOptions {
  level: string;
  /** Nome do serviço em todo log (`service`). */
  service: string;
  /** Destino alternativo (testes capturam o log por aqui). */
  destination?: DestinationStream;
}

export function buildLoggerOptions(opts: CreateLoggerOptions): LoggerOptions {
  return {
    level: opts.level,
    base: { service: opts.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const options = buildLoggerOptions(opts);
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

/** `12345678912` → `***.***.***-12`. Única forma de CPF permitida em log. */
export function maskCpf(cpf: string): string {
  const digits = cpf.replace(/\D/g, '');
  return `***.***.***-${digits.slice(-2).padStart(2, '*')}`;
}
