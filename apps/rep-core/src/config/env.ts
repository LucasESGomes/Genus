/**
 * Configuração do rep-core (worker da fila), validada com Zod na partida.
 * Erro de configuração lista só os NOMES das variáveis, nunca os valores
 * (URL de banco e senha do Valkey são segredos).
 */
import type { QueueConfig } from '@genus/queue';
import { z } from 'zod';

export const APP_ENVS = ['dev', 'test', 'homolog', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

/** Ambientes em que a senha do Valkey pode faltar. Qualquer outro a exige. */
const PASSWORD_OPTIONAL_ENVS: readonly AppEnv[] = ['dev', 'test'];

export class RepCoreConfigError extends Error {
  override readonly name = 'RepCoreConfigError';
  readonly variables: string[];
  constructor(problems: { variable: string; message: string }[]) {
    super(
      'Configuração do rep-core inválida:\n' +
        problems.map((p) => `  - ${p.variable}: ${p.message}`).join('\n'),
    );
    this.variables = problems.map((p) => p.variable);
  }
}

const intBetween = (name: string, min: number, max: number) => {
  const message = `${name} deve ser um inteiro entre ${min} e ${max}`;
  return z.coerce.number({ error: message }).int(message).min(min, message).max(max, message);
};

const positiveInt = (name: string) => {
  const message = `${name} deve ser um inteiro maior que zero`;
  return z.coerce.number({ error: message }).int(message).positive(message);
};

const valkeyUrl = z
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
  APP_ENV: z.enum(APP_ENVS, { error: 'APP_ENV deve ser dev, test, homolog ou prod' }),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: 'LOG_LEVEL inválido' }).optional(),
  ARP_CORE_DATABASE_URL: z
    .string({ error: 'ARP_CORE_DATABASE_URL é obrigatória' })
    .min(1, 'ARP_CORE_DATABASE_URL é obrigatória'),
  VALKEY_URL: valkeyUrl,
  VALKEY_PASSWORD: z.string().min(1).optional(),
  WORKER_CONCURRENCY: intBetween('WORKER_CONCURRENCY', 1, 32).default(4),
  QUEUE_ATTEMPTS: positiveInt('QUEUE_ATTEMPTS').default(5),
  QUEUE_PUBLISH_TIMEOUT_MS: positiveInt('QUEUE_PUBLISH_TIMEOUT_MS').default(250),
});

export interface RepCoreConfig {
  appEnv: AppEnv;
  logLevel: string;
  databaseUrl: string;
  queue: QueueConfig;
  concurrency: number;
  /** Conexões do `Pool`: uma por job concorrente, mais folga para UPDATEs de erro e o shutdown. */
  poolMax: number;
}

/** Variável vazia conta como ausente. Lança `RepCoreConfigError` (só nomes, nunca valores). */
export function loadRepCoreConfig(
  source: Record<string, string | undefined> = process.env,
): RepCoreConfig {
  const input: Record<string, string> = {};
  for (const key of Object.keys(rawSchema.shape)) {
    const value = source[key];
    if (value !== undefined && value !== '') input[key] = value;
  }
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) {
    throw new RepCoreConfigError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'ambiente'),
        message: issue.message,
      })),
    );
  }
  const raw = parsed.data;
  if (!PASSWORD_OPTIONAL_ENVS.includes(raw.APP_ENV) && raw.VALKEY_PASSWORD === undefined) {
    throw new RepCoreConfigError([
      { variable: 'VALKEY_PASSWORD', message: `obrigatória quando APP_ENV é ${raw.APP_ENV}` },
    ]);
  }
  return {
    appEnv: raw.APP_ENV,
    logLevel: raw.LOG_LEVEL ?? (raw.APP_ENV === 'prod' ? 'info' : 'debug'),
    databaseUrl: raw.ARP_CORE_DATABASE_URL,
    queue: {
      url: raw.VALKEY_URL,
      password: raw.VALKEY_PASSWORD,
      publishTimeoutMs: raw.QUEUE_PUBLISH_TIMEOUT_MS,
      attempts: raw.QUEUE_ATTEMPTS,
    },
    concurrency: raw.WORKER_CONCURRENCY,
    poolMax: raw.WORKER_CONCURRENCY + 4,
  };
}
