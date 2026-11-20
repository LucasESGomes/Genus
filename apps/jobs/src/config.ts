/**
 * Configuração do processo de resgate (`apps/jobs`). Erro de configuração lista só
 * os NOMES das variáveis, nunca os valores (URL do banco e senha são segredos).
 */
import { z } from 'zod';

export const APP_ENVS = ['dev', 'test', 'homolog', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
const PASSWORD_OPTIONAL_ENVS: readonly AppEnv[] = ['dev', 'test'];

export class JobsConfigError extends Error {
  override readonly name = 'JobsConfigError';
  readonly variables: string[];
  constructor(problems: { variable: string; message: string }[]) {
    super(
      'Configuração do jobs inválida:\n' + problems.map((p) => `  - ${p.variable}: ${p.message}`).join('\n'),
    );
    this.variables = problems.map((p) => p.variable);
  }
}

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
  ARP_READER_DATABASE_URL: z
    .string({ error: 'ARP_READER_DATABASE_URL é obrigatória' })
    .min(1, 'ARP_READER_DATABASE_URL é obrigatória'),
  VALKEY_URL: valkeyUrl,
  VALKEY_PASSWORD: z.string().min(1).optional(),
  RESCUE_INTERVAL_MS: positiveInt('RESCUE_INTERVAL_MS').default(20_000),
  RESCUE_MIN_AGE_MS: positiveInt('RESCUE_MIN_AGE_MS').default(30_000),
  POST_PUNCH_DEPTH_WARN: positiveInt('POST_PUNCH_DEPTH_WARN').default(10_000),
  QUEUE_ATTEMPTS: positiveInt('QUEUE_ATTEMPTS').default(5),
});

export interface JobsConfig {
  appEnv: AppEnv;
  logLevel: string;
  databaseUrl: string;
  valkeyUrl: string;
  valkeyPassword: string | undefined;
  intervalMs: number;
  minAgeMs: number;
  postPunchDepthWarn: number;
  attempts: number;
}

/** Variável vazia conta como ausente. Lança `JobsConfigError` (só nomes, nunca valores). */
export function loadJobsConfig(source: Record<string, string | undefined> = process.env): JobsConfig {
  const input: Record<string, string> = {};
  for (const key of Object.keys(rawSchema.shape)) {
    const value = source[key];
    if (value !== undefined && value !== '') input[key] = value;
  }
  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) {
    throw new JobsConfigError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'ambiente'),
        message: issue.message,
      })),
    );
  }
  const raw = parsed.data;
  if (!PASSWORD_OPTIONAL_ENVS.includes(raw.APP_ENV) && raw.VALKEY_PASSWORD === undefined) {
    throw new JobsConfigError([
      { variable: 'VALKEY_PASSWORD', message: `obrigatória quando APP_ENV é ${raw.APP_ENV}` },
    ]);
  }
  return {
    appEnv: raw.APP_ENV,
    logLevel: raw.LOG_LEVEL ?? (raw.APP_ENV === 'prod' ? 'info' : 'debug'),
    databaseUrl: raw.ARP_READER_DATABASE_URL,
    valkeyUrl: raw.VALKEY_URL,
    valkeyPassword: raw.VALKEY_PASSWORD,
    intervalMs: raw.RESCUE_INTERVAL_MS,
    minAgeMs: raw.RESCUE_MIN_AGE_MS,
    postPunchDepthWarn: raw.POST_PUNCH_DEPTH_WARN,
    attempts: raw.QUEUE_ATTEMPTS,
  };
}
