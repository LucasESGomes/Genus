/**
 * Configuração da fila. Erro de configuração lista só os NOMES das variáveis,
 * nunca os valores (URL e senha são segredos).
 */
import { z } from 'zod';

export class QueueConfigError extends Error {
  override readonly name = 'QueueConfigError';
  readonly variables: string[];
  constructor(problems: { variable: string; message: string }[]) {
    super('Configuração da fila inválida:\n' + problems.map((p) => `  - ${p.variable}: ${p.message}`).join('\n'));
    this.variables = problems.map((p) => p.variable);
  }
}

export interface QueueConfig {
  /** `redis://host:porta` ou `rediss://host:porta`, SEM senha. */
  url: string;
  password: string | undefined;
  publishTimeoutMs: number;
  attempts: number;
}

const positiveInt = (name: string) => {
  const message = `${name} deve ser um inteiro maior que zero`;
  return z.coerce.number({ error: message }).int(message).positive(message);
};

const urlSchema = z
  .string({ error: 'VALKEY_URL é obrigatória' })
  .min(1, 'VALKEY_URL é obrigatória')
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'VALKEY_URL deve ser redis://host:porta ou rediss://host:porta' });
      return;
    }
    if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
      ctx.addIssue({ code: 'custom', message: 'VALKEY_URL deve começar com redis:// ou rediss://' });
    } else if (parsed.password !== '') {
      ctx.addIssue({ code: 'custom', message: 'VALKEY_URL não pode conter senha; use VALKEY_PASSWORD' });
    }
  });

const rawSchema = z.object({
  APP_ENV: z.string({ error: 'APP_ENV é obrigatória' }).min(1, 'APP_ENV é obrigatória'),
  VALKEY_URL: urlSchema,
  VALKEY_PASSWORD: z.string().min(1).optional(),
  QUEUE_PUBLISH_TIMEOUT_MS: positiveInt('QUEUE_PUBLISH_TIMEOUT_MS').default(250),
  QUEUE_ATTEMPTS: positiveInt('QUEUE_ATTEMPTS').default(5),
});

/** Ambientes em que a senha do Valkey pode faltar. */
const PASSWORD_OPTIONAL_ENVS = ['dev', 'test'];

/** Variável vazia conta como ausente. Lança `QueueConfigError`. */
export function loadQueueConfig(source: Record<string, string | undefined> = process.env): QueueConfig {
  const input: Record<string, string> = {};
  for (const key of Object.keys(rawSchema.shape)) {
    const value = source[key];
    if (value !== undefined && value !== '') input[key] = value;
  }
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) {
    throw new QueueConfigError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'ambiente'),
        message: issue.message,
      })),
    );
  }
  const raw = parsed.data;
  if (!PASSWORD_OPTIONAL_ENVS.includes(raw.APP_ENV) && raw.VALKEY_PASSWORD === undefined) {
    throw new QueueConfigError([
      { variable: 'VALKEY_PASSWORD', message: `obrigatória quando APP_ENV é ${raw.APP_ENV}` },
    ]);
  }
  return {
    url: raw.VALKEY_URL,
    password: raw.VALKEY_PASSWORD,
    publishTimeoutMs: raw.QUEUE_PUBLISH_TIMEOUT_MS,
    attempts: raw.QUEUE_ATTEMPTS,
  };
}
