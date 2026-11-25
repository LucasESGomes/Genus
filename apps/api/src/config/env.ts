/**
 * Configuração da api do portal de RH, validada com Zod na partida. Falta de
 * variável ou valor inválido derruba o processo; a mensagem lista os NOMES das
 * variáveis com problema, nunca os valores (podem ser segredos).
 */
import { z } from 'zod';
import { PROVIDER_IDS } from '../modules/certificate-analysis/ai/provider';
import { MIN_PASSWORD_LENGTH } from '../modules/auth/auth';
import type { CertificateAiConfig } from '../modules/certificate-analysis/ai/registry';

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
  // Better Auth: assina cookies e cifra o segredo do 2FA e a chave privada do JWT.
  BETTER_AUTH_SECRET: requiredString('BETTER_AUTH_SECRET').min(32, 'BETTER_AUTH_SECRET precisa de pelo menos 32 caracteres'),
  // Só a origem (sem caminho): emissor e audiência do JWT. Padrão http://localhost:<PORT>.
  AUTH_BASE_URL: z
    .url({ error: 'AUTH_BASE_URL deve ser uma URL' })
    .refine((v) => new URL(v).pathname === '/', 'AUTH_BASE_URL deve ser só a origem, sem caminho (ex.: https://rh.exemplo.com)')
    .optional(),
  // Leitura das batidas no banco arp (papel arp_reader, só SELECT). A apuração lê daqui.
  ARP_READER_DATABASE_URL: requiredString('ARP_READER_DATABASE_URL'),
  // Pepper do PIN do colaborador (HMAC antes do scrypt): 32 bytes em hex. Trocar invalida os PINs.
  PIN_PEPPER: z
    .string({ error: 'PIN_PEPPER é obrigatória' })
    .regex(/^[0-9a-fA-F]{64}$/, 'PIN_PEPPER deve ter 64 caracteres hex (32 bytes)'),
  PIN_PEPPER_VERSION: positiveInt('PIN_PEPPER_VERSION').default(1),
  // Engine facial, só para o cadastro do rosto no totem (POST /embeddings/register). Sem ela: 503.
  ENGINE_URL: z.url({ error: 'ENGINE_URL deve ser uma URL' }).optional(),
  ENGINE_API_KEY: z.string().min(1).optional(),
  // Limiares padrão da engine (config.py: recognition_threshold 1.10 e liveness_threshold 0.85). Só servem
  // para mostrar o valor efetivo de um totem sem calibração; quem decide é a engine. Mudou lá, mude aqui.
  ENGINE_DEFAULT_RECOGNITION_THRESHOLD: z.coerce.number().min(0.5).max(2).default(1.1),
  ENGINE_DEFAULT_LIVENESS_THRESHOLD: z.coerce.number().min(0.5).max(0.95).default(0.85),
  // Pasta dos arquivos de atestado (adaptador em disco; o S3 entra depois).
  ATTACHMENTS_DIR: z.string().min(1).default('./data/anexos'),
  MAX_ATTACHMENT_BYTES: positiveInt('MAX_ATTACHMENT_BYTES').default(10 * 1024 * 1024),
  // Gestor é opcional e começa desligado (04 §1.4).
  PORTAL_GESTOR_ENABLED: z
    .enum(['true', 'false'], { error: 'PORTAL_GESTOR_ENABLED deve ser true ou false' })
    .default('false'),
  // Análise de atestado com IA (G6). Tudo opcional: sem provedor, modelo ou chave, a análise usa a
  // mock determinística e avisa IA_SIMULADA. As chaves nunca vão para log nem para o repositório.
  CERTIFICATE_AI_PROVIDER: z.enum(PROVIDER_IDS, { error: 'CERTIFICATE_AI_PROVIDER deve ser mock, anthropic ou openai_compativel' }).optional(),
  CERTIFICATE_AI_MODEL: z.string().min(1).max(120).optional(),
  CERTIFICATE_AI_ANTHROPIC_API_KEY: z.string().min(1).optional(),
  CERTIFICATE_AI_ANTHROPIC_BASE_URL: z.url({ error: 'CERTIFICATE_AI_ANTHROPIC_BASE_URL deve ser uma URL' }).optional(),
  CERTIFICATE_AI_OPENAI_API_KEY: z.string().min(1).optional(),
  // Base do servidor OpenAI-compatível, até o /v1 (ex.: http://ollama:11434/v1 para modelo local).
  CERTIFICATE_AI_OPENAI_BASE_URL: z.url({ error: 'CERTIFICATE_AI_OPENAI_BASE_URL deve ser uma URL' }).optional(),
  CERTIFICATE_AI_TIMEOUT_MS: positiveInt('CERTIFICATE_AI_TIMEOUT_MS').default(20_000),
  // Chave AES-256 (64 hex) do dado de saúde da análise (CID, texto, evidências). Sem ela, nada disso é gravado.
  CERTIFICATE_DATA_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'CERTIFICATE_DATA_KEY deve ter 64 caracteres hex (32 bytes)')
    .optional(),
  // super_admin da plataforma (modules/super-admin/bootstrap.ts): criado/atualizado na partida. As três primeiras
  // são tudo ou nada; hash (scrypt do Better Auth, `pnpm rh:hash-password`) é preferido à senha em claro.
  SUPER_ADMIN_EMAIL: z.email({ error: 'SUPER_ADMIN_EMAIL deve ser um e-mail' }).max(254).optional(),
  SUPER_ADMIN_NAME: z.string().trim().min(1).max(200).optional(),
  SUPER_ADMIN_PASSWORD_HASH: z
    .string()
    .regex(/^[0-9a-f]{32}:[0-9a-f]{128}$/, 'SUPER_ADMIN_PASSWORD_HASH deve ser o hash scrypt do Better Auth (<salt hex>:<chave hex>); gere com pnpm rh:hash-password')
    .optional(),
  SUPER_ADMIN_PASSWORD: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `SUPER_ADMIN_PASSWORD precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres`)
    .max(128, 'SUPER_ADMIN_PASSWORD aceita no máximo 128 caracteres')
    .optional(),
  // KEK (64 hex) que cifra a DEK da empresa nova (POST /super-admin/tenants). Igual à do coletor e da engine.
  MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEY deve ter 64 caracteres hex (32 bytes)')
    .optional(),
  // Painel do super_admin: saúde do sistema. Sem elas, o check aparece como não configurado.
  VALKEY_URL: z.url({ error: 'VALKEY_URL deve ser uma URL' }).optional(),
  VALKEY_PASSWORD: z.string().min(1).optional(),
  COLLECTOR_API_URL: z.url({ error: 'COLLECTOR_API_URL deve ser uma URL' }).optional(),
});

/** Credencial do super_admin da plataforma: hash pronto ou senha em claro (o hash vence). */
export type SuperAdminPassword = { kind: 'hash'; value: string } | { kind: 'plain'; value: string };
export interface SuperAdminConfig {
  email: string;
  name: string;
  password: SuperAdminPassword;
}

export interface Env {
  appEnv: AppEnv;
  port: number;
  logLevel: string;
  databaseUrl: string;
  databasePoolMax: number;
  corsOrigins: string[];
  authSecret: string;
  authBaseUrl: string;
  arpReaderDatabaseUrl: string;
  pinPepper: { version: number; keyHex: string };
  engine: { url: string; apiKey: string } | null;
  engineDefaults: { recognitionThreshold: number; livenessThreshold: number };
  attachmentsDir: string;
  maxAttachmentBytes: number;
  gestorEnabled: boolean;
  certificateAi: CertificateAiConfig;
  /** Chave do dado de saúde da análise de atestado; null = não grava CID, texto nem evidências. */
  certificateDataKeyHex: string | null;
  /** null = SUPER_ADMIN_* ausentes (nenhum super_admin é criado na partida). */
  superAdmin: SuperAdminConfig | null;
  /** KEK (64 hex) da DEK das empresas novas; null = POST /super-admin/tenants responde 503. */
  masterKeyHex: string | null;
  valkeyUrl: string | null;
  valkeyPassword: string | null;
  collectorApiUrl: string | null;
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
  const superAdmin = superAdminFrom(raw);

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
    authSecret: raw.BETTER_AUTH_SECRET,
    authBaseUrl: new URL(raw.AUTH_BASE_URL ?? `http://localhost:${raw.PORT}`).origin,
    arpReaderDatabaseUrl: raw.ARP_READER_DATABASE_URL,
    pinPepper: { version: raw.PIN_PEPPER_VERSION, keyHex: raw.PIN_PEPPER },
    engine: raw.ENGINE_URL && raw.ENGINE_API_KEY ? { url: raw.ENGINE_URL, apiKey: raw.ENGINE_API_KEY } : null,
    engineDefaults: { recognitionThreshold: raw.ENGINE_DEFAULT_RECOGNITION_THRESHOLD, livenessThreshold: raw.ENGINE_DEFAULT_LIVENESS_THRESHOLD },
    attachmentsDir: raw.ATTACHMENTS_DIR,
    maxAttachmentBytes: raw.MAX_ATTACHMENT_BYTES,
    gestorEnabled: raw.PORTAL_GESTOR_ENABLED === 'true',
    superAdmin,
    masterKeyHex: raw.MASTER_KEY ?? null,
    valkeyUrl: raw.VALKEY_URL ?? null,
    valkeyPassword: raw.VALKEY_PASSWORD ?? null,
    collectorApiUrl: raw.COLLECTOR_API_URL ?? null,
    ...certificateAiFrom(raw),
  };
}

/** E-mail, nome e senha (ou hash) vêm juntos ou não vêm. A mensagem cita só os nomes, nunca os valores. */
function superAdminFrom(raw: z.infer<typeof rawSchema>): SuperAdminConfig | null {
  const password: SuperAdminPassword | null = raw.SUPER_ADMIN_PASSWORD_HASH
    ? { kind: 'hash', value: raw.SUPER_ADMIN_PASSWORD_HASH }
    : raw.SUPER_ADMIN_PASSWORD
      ? { kind: 'plain', value: raw.SUPER_ADMIN_PASSWORD }
      : null;
  const present = [raw.SUPER_ADMIN_EMAIL, raw.SUPER_ADMIN_NAME, password].filter((v) => v !== undefined && v !== null).length;
  if (present === 0) return null;
  if (present < 3) {
    throw new EnvError([
      {
        variable: 'SUPER_ADMIN_EMAIL',
        message: 'defina SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME e SUPER_ADMIN_PASSWORD_HASH (ou SUPER_ADMIN_PASSWORD) juntas, ou nenhuma',
      },
    ]);
  }
  return { email: raw.SUPER_ADMIN_EMAIL!, name: raw.SUPER_ADMIN_NAME!, password: password! };
}

const AI_KEYS = [
  'CERTIFICATE_AI_PROVIDER',
  'CERTIFICATE_AI_MODEL',
  'CERTIFICATE_AI_ANTHROPIC_API_KEY',
  'CERTIFICATE_AI_ANTHROPIC_BASE_URL',
  'CERTIFICATE_AI_OPENAI_API_KEY',
  'CERTIFICATE_AI_OPENAI_BASE_URL',
  'CERTIFICATE_AI_TIMEOUT_MS',
  'CERTIFICATE_DATA_KEY',
] as const;

/**
 * Só as variáveis da análise de atestado (comando de comparação, que roda sem
 * banco). Mesmas regras de validação do `loadEnv`; lança `EnvError`.
 */
export function loadCertificateAiEnv(source: Record<string, string | undefined> = process.env): {
  certificateAi: CertificateAiConfig;
  certificateDataKeyHex: string | null;
} {
  const input: Record<string, string> = {};
  for (const key of AI_KEYS) {
    const value = source[key];
    if (value !== undefined && value !== '' && !value.includes('TROQUE')) input[key] = value;
  }
  const schema = rawSchema.pick(Object.fromEntries(AI_KEYS.map((k) => [k, true])) as { [K in (typeof AI_KEYS)[number]]: true });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => ({ variable: String(i.path[0] ?? 'ambiente'), message: i.message })));
  }
  return certificateAiFrom(parsed.data);
}

function certificateAiFrom(raw: Pick<z.infer<typeof rawSchema>, (typeof AI_KEYS)[number]>): {
  certificateAi: CertificateAiConfig;
  certificateDataKeyHex: string | null;
} {
  return {
    certificateAi: {
      provider: raw.CERTIFICATE_AI_PROVIDER ?? null,
      model: raw.CERTIFICATE_AI_MODEL ?? null,
      anthropicApiKey: raw.CERTIFICATE_AI_ANTHROPIC_API_KEY ?? null,
      anthropicBaseUrl: raw.CERTIFICATE_AI_ANTHROPIC_BASE_URL ?? null,
      openaiApiKey: raw.CERTIFICATE_AI_OPENAI_API_KEY ?? null,
      openaiBaseUrl: raw.CERTIFICATE_AI_OPENAI_BASE_URL ?? null,
      timeoutMs: raw.CERTIFICATE_AI_TIMEOUT_MS,
    },
    certificateDataKeyHex: raw.CERTIFICATE_DATA_KEY ?? null,
  };
}
