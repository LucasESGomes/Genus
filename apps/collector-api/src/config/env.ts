/**
 * Configuração da api do coletor, validada com Zod na partida. Falta de
 * variável ou valor inválido derruba o processo; a mensagem lista os NOMES das
 * variáveis com problema, nunca os valores (podem ser segredos).
 */
import { parseMasterKey } from '@genus/shared';
import { z } from 'zod';

export const APP_ENVS = ['dev', 'homolog', 'prod'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;

const strictBool = (name: string) =>
  z.enum(['true', 'false'], { error: `${name} deve ser "true" ou "false"` }).transform((v) => v === 'true');

const positiveInt = (name: string) => {
  const message = `${name} deve ser um inteiro maior que zero`;
  return z.coerce.number({ error: message }).int(message).positive(message);
};

const requiredString = (name: string) =>
  z.string({ error: `${name} é obrigatória` }).min(1, `${name} é obrigatória`);

/** Tamanho mínimo de cada chave de serviço em produção. */
export const MIN_PROD_SERVICE_KEY_LENGTH = 32;

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS, { error: 'APP_ENV deve ser dev, homolog ou prod' }),
  PORT: positiveInt('PORT').default(3001),
  LOG_LEVEL: z.enum(LOG_LEVELS, { error: 'LOG_LEVEL inválido' }).optional(),
  ARP_DATABASE_URL: requiredString('ARP_DATABASE_URL'),
  // Banco `app`, papel somente leitura `genus_coletor_leitura` (docs/totem-contrato.md §2 e §4).
  // Autentica a chave do aparelho (totem) e lê os candidatos reais. Obrigatória sem candidatos fictícios.
  APP_READONLY_DATABASE_URL: z.string().optional(),
  ENGINE_URL: requiredString('ENGINE_URL'),
  ENGINE_API_KEY: requiredString('ENGINE_API_KEY'),
  MASTER_KEY: z
    .string({ error: 'MASTER_KEY é obrigatória' })
    .refine((v) => {
      try {
        parseMasterKey(v);
        return true;
      } catch {
        return false;
      }
    }, 'MASTER_KEY deve ter 64 caracteres hexadecimais'),
  ENGINE_TIMEOUT_MS: positiveInt('ENGINE_TIMEOUT_MS').default(800),
  ENGINE_MAX_CONCURRENCY: positiveInt('ENGINE_MAX_CONCURRENCY').default(4),
  COLLECTOR_SERVICE_KEYS: z
    .string({ error: 'COLLECTOR_SERVICE_KEYS é obrigatória' })
    .transform((v) =>
      v
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0),
    )
    .pipe(z.array(z.string()).min(1, 'COLLECTOR_SERVICE_KEYS precisa de ao menos uma chave')),
  MAX_IMAGE_BYTES: positiveInt('MAX_IMAGE_BYTES').default(1_048_576),
  FAKE_CANDIDATES_ENABLED: strictBool('FAKE_CANDIDATES_ENABLED'),
  FAKE_CANDIDATES_COUNT: positiveInt('FAKE_CANDIDATES_COUNT').default(20),
  DEV_GALLERY_PATH: z.string().optional(),
  EXPOSE_TIMINGS: strictBool('EXPOSE_TIMINGS').default(false),
  DEV_TENANT_ID: positiveInt('DEV_TENANT_ID'),
  DEV_ESTABLISHMENT_ID: positiveInt('DEV_ESTABLISHMENT_ID'),
  DEV_DEVICE_ID: positiveInt('DEV_DEVICE_ID'),
  // Fila (docs/SPEC-nsr-fila.md §9). URL sem senha; a senha vem separada e nunca é logada.
  VALKEY_URL: z
    .string()
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === 'redis:' || u.protocol === 'rediss:') && u.password === '';
      } catch {
        return false;
      }
    }, 'VALKEY_URL deve ser redis://host:porta ou rediss://host:porta, sem senha (use VALKEY_PASSWORD)')
    .optional(),
  VALKEY_PASSWORD: z.string().optional(),
  QUEUE_PUBLISH_TIMEOUT_MS: positiveInt('QUEUE_PUBLISH_TIMEOUT_MS').default(250),
  QUEUE_ATTEMPTS: positiveInt('QUEUE_ATTEMPTS').default(5),
});

export interface Env {
  appEnv: AppEnv;
  port: number;
  logLevel: string;
  arpDatabaseUrl: string;
  /** Ausente = sem rota do totem e sem candidatos reais (só dev com candidatos fictícios). */
  appReadonlyDatabaseUrl: string | undefined;
  engineUrl: string;
  engineApiKey: string;
  masterKey: string;
  engineTimeoutMs: number;
  engineMaxConcurrency: number;
  serviceKeys: string[];
  maxImageBytes: number;
  fakeCandidatesEnabled: boolean;
  fakeCandidatesCount: number;
  devGalleryPath: string | undefined;
  exposeTimings: boolean;
  devTenantId: number;
  devEstablishmentId: number;
  devDeviceId: number;
  /** Ausente = a api sobe sem fila (a publicação é opcional; o resgate cobre). */
  valkeyUrl: string | undefined;
  valkeyPassword: string | undefined;
  queuePublishTimeoutMs: number;
  queueAttempts: number;
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
    // Só mensagens escritas por nós; as padrão do Zod também não carregam o valor recebido.
    throw new EnvError(
      parsed.error.issues.map((issue) => ({
        variable: String(issue.path[0] ?? 'ambiente'),
        message: issue.message,
      })),
    );
  }
  const raw = parsed.data;

  // Placeholder dos arquivos .env*.example copiado sem editar: recusa em qualquer ambiente
  // (as chaves dos exemplos são públicas).
  const placeholders = Object.entries(input)
    .filter(([, value]) => value.includes('TROQUE'))
    .map(([variable]) => ({ variable, message: 'ainda tem o placeholder TROQUE_ do arquivo de exemplo' }));
  if (placeholders.length > 0) throw new EnvError(placeholders);

  if (raw.APP_ENV === 'prod') {
    const problems: { variable: string; message: string }[] = [];
    if (raw.FAKE_CANDIDATES_ENABLED) {
      problems.push({ variable: 'FAKE_CANDIDATES_ENABLED', message: 'proibido em prod' });
    }
    if (raw.EXPOSE_TIMINGS) {
      problems.push({ variable: 'EXPOSE_TIMINGS', message: 'proibido em prod' });
    }
    if (raw.COLLECTOR_SERVICE_KEYS.some((k) => k.length < MIN_PROD_SERVICE_KEY_LENGTH)) {
      problems.push({
        variable: 'COLLECTOR_SERVICE_KEYS',
        message: `em prod cada chave precisa ter ${MIN_PROD_SERVICE_KEY_LENGTH} caracteres ou mais`,
      });
    }
    if (problems.length > 0) throw new EnvError(problems);
  }

  // Sem candidatos fictícios, os candidatos vêm do banco `app`.
  if (!raw.FAKE_CANDIDATES_ENABLED && raw.APP_READONLY_DATABASE_URL === undefined) {
    throw new EnvError([
      { variable: 'APP_READONLY_DATABASE_URL', message: 'obrigatória quando FAKE_CANDIDATES_ENABLED=false' },
    ]);
  }

  // Fora de dev, o Valkey exige senha. Sem VALKEY_URL a fila fica desligada e não há o que proteger.
  if (raw.APP_ENV !== 'dev' && raw.VALKEY_URL !== undefined && raw.VALKEY_PASSWORD === undefined) {
    throw new EnvError([{ variable: 'VALKEY_PASSWORD', message: 'obrigatória em homolog e prod' }]);
  }

  return {
    appEnv: raw.APP_ENV,
    port: raw.PORT,
    logLevel: raw.LOG_LEVEL ?? (raw.APP_ENV === 'dev' ? 'debug' : 'info'),
    arpDatabaseUrl: raw.ARP_DATABASE_URL,
    appReadonlyDatabaseUrl: raw.APP_READONLY_DATABASE_URL,
    engineUrl: raw.ENGINE_URL,
    engineApiKey: raw.ENGINE_API_KEY,
    masterKey: raw.MASTER_KEY,
    engineTimeoutMs: raw.ENGINE_TIMEOUT_MS,
    engineMaxConcurrency: raw.ENGINE_MAX_CONCURRENCY,
    serviceKeys: raw.COLLECTOR_SERVICE_KEYS,
    maxImageBytes: raw.MAX_IMAGE_BYTES,
    fakeCandidatesEnabled: raw.FAKE_CANDIDATES_ENABLED,
    fakeCandidatesCount: raw.FAKE_CANDIDATES_COUNT,
    devGalleryPath: raw.DEV_GALLERY_PATH,
    exposeTimings: raw.EXPOSE_TIMINGS,
    devTenantId: raw.DEV_TENANT_ID,
    devEstablishmentId: raw.DEV_ESTABLISHMENT_ID,
    devDeviceId: raw.DEV_DEVICE_ID,
    valkeyUrl: raw.VALKEY_URL,
    valkeyPassword: raw.VALKEY_PASSWORD,
    queuePublishTimeoutMs: raw.QUEUE_PUBLISH_TIMEOUT_MS,
    queueAttempts: raw.QUEUE_ATTEMPTS,
  };
}
