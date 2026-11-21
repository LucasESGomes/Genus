/**
 * Configuração da api do portal de RH, validada com Zod na partida. Falta de
 * variável ou valor inválido derruba o processo; a mensagem lista os NOMES das
 * variáveis com problema, nunca os valores (podem ser segredos).
 */
import { z } from 'zod';

export const APP_ENVS = ['dev', 'homolog', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

const positiveInt = (name: string) => {
  const message = `${name} deve ser um inteiro maior que zero`;
  return z.coerce.number({ error: message }).int(message).positive(message);
};

const requiredString = (name: string) =>
  z.string({ error: `${name} é obrigatória` }).min(1, `${name} é obrigatória`);

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS, { error: 'APP_ENV deve ser dev, homolog ou prod' }),
  PORT: positiveInt('PORT').default(3002),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: 'LOG_LEVEL inválido' }).optional(),
  // Papel rh_api (runtime). As migrations usam RH_MIGRATION_DATABASE_URL (rh_owner), lida só por src/db/migrate.ts.
  RH_DATABASE_URL: requiredString('RH_DATABASE_URL'),
  DATABASE_POOL_MAX: positiveInt('DATABASE_POOL_MAX').default(10),
  // Origens do portal, separadas por vírgula. Vazio = sem CORS (portal servido pelo mesmo domínio, via nginx).
  CORS_ORIGINS: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    )
    .optional(),
});

export interface Env {
  appEnv: AppEnv;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databasePoolMax: number;
  corsOrigins: string[];
}

export class EnvError extends Error {
  override readonly name = 'EnvError';
  /** Nomes das variáveis com problema (sem valores). */
  readonly variables: string[];
  constructor(problems: { variable: string; message: string }[]) {
    super('Configuração inválida:\n' + problems.map((p) => `  - ${p.variable}: ${p.message}`).join('\n'));
    this.variables = problems.map((p) => p.variable);
  }
}

/** Lê e valida o ambiente. Variável vazia conta como ausente. Lança `EnvError`. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const input: Record<string, string> = {};
  for (const key of Object.keys(rawSchema.shape)) {
    const value = source[key];
    if (value !== undefined && value !== '') input[key] = value;
  }

  const parsed = rawSchema.safeParse(input);
  if (!parsed.success) {
    throw new EnvError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'ambiente'),
        message: issue.message,
      })),
    );
  }
  const raw = parsed.data;

  // Placeholder dos arquivos .env*.example copiado sem editar.
  const placeholders = Object.entries(input)
    .filter(([, value]) => value.includes('TROQUE'))
    .map(([variable]) => ({ variable, message: 'ainda tem o placeholder TROQUE_ do arquivo de exemplo' }));
  if (placeholders.length > 0) throw new EnvError(placeholders);

  return {
    appEnv: raw.APP_ENV,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL ?? (raw.APP_ENV === 'dev' ? 'debug' : 'info'),
    databaseUrl: raw.RH_DATABASE_URL,
    databasePoolMax: raw.DATABASE_POOL_MAX,
    corsOrigins: raw.CORS_ORIGINS ?? [],
  };
}
