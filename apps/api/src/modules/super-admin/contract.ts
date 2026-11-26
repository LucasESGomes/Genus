/**
 * Contrato do painel do super_admin (docs/prompts/super-admin-contrato.md). Único ponto de acoplamento
 * entre o back e o front (apps/portal/src/lib/api/super-admin-contracts.ts espelha estes tipos).
 * Só o coordenador altera este arquivo.
 *
 * Regras (security-lgpd §5, 04 §1.4): nenhuma resposta leva CPF, nome de colaborador, batida individual,
 * dado de saúde, biometria, hash, coluna cifrada, token ou segredo. Todo objeto de resposta é `strictObject`:
 * campo a mais quebra a serialização em vez de vazar.
 */
import { z } from 'zod';
import { isoInstant, listMeta, pagination, positiveId, reasonText } from '../../http/schemas';
import { inviteDto } from '../invites/schemas';

// ---------------------------------------------------------------- comum

export const WINDOWS = ['24h', '7d', '30d'] as const;
export type StatsWindow = (typeof WINDOWS)[number];
export const windowQuery = z.object({ window: z.enum(WINDOWS).default('24h') });

export const tenantIdParams = z.object({ tenantId: positiveId });

/** Cursor opaco = último `id` visto (ordem `id DESC`). */
export const cursorQuery = z.object({
  cursor: positiveId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const cursorMeta = z.strictObject({ nextCursor: z.number().nullable(), limit: z.number() });

/** Período fechado-aberto [from, to). Máximo 90 dias (validado no service). */
const period = { from: isoInstant.optional(), to: isoInstant.optional() };

// ---------------------------------------------------------------- tenants

export const TENANT_STATUSES = ['ativa', 'suspensa'] as const;

export const listTenantsQuery = pagination.extend({
  q: z.string().trim().min(1).max(100).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
});

const cnpj = z.string().regex(/^\d{14}$/, 'CNPJ com 14 dígitos, sem pontuação');

export const createTenantBody = z.object({
  name: z.string().trim().min(2).max(120),
  company: z.object({ legalName: z.string().trim().min(2).max(200), cnpj }),
  establishment: z.object({
    name: z.string().trim().min(2).max(120),
    registrationType: z.enum(['CNPJ', 'CPF', 'CAEPF']),
    registration: z.string().regex(/^\d{11,14}$/, 'só dígitos'),
    uf: z.string().regex(/^[A-Z]{2}$/),
    municipalityIbge: z.string().regex(/^\d{7}$/),
  }),
  /** Vira um convite (link com confirmação de CPF); o usuário só nasce no aceite. */
  admin: z.object({ name: z.string().trim().min(1).max(200), email: z.email().max(254), cpf: z.string().trim().min(1).max(20) }),
});

export const updateTenantBody = z.object({ name: z.string().trim().min(2).max(120) });
export const suspensionBody = z.object({ reason: reasonText });

export const tenantCounts = z.strictObject({ employees: z.number(), devices: z.number(), users: z.number(), establishments: z.number() });

export const tenantDto = z.strictObject({
  id: z.number(),
  name: z.string(),
  status: z.enum(TENANT_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  suspendedAt: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  counts: tenantCounts,
});
export type TenantDto = z.infer<typeof tenantDto>;

export const tenantDetailDto = tenantDto.extend({
  companies: z.array(z.strictObject({ id: z.number(), legalName: z.string(), cnpj: z.string(), isActive: z.boolean() })),
  /** Usuários do cliente (operadores do portal, não colaboradores). Sem colaborador_id. */
  admins: z.array(z.strictObject({ id: z.number(), name: z.string(), email: z.string(), role: z.string(), isActive: z.boolean(), mfaEnabled: z.boolean() })),
  hasCompanyKey: z.boolean(),
});

export const tenantListResponse = z.strictObject({ data: z.array(tenantDto), meta: listMeta });
export const tenantResponse = z.strictObject({ data: tenantDetailDto });
/** `token` do convite do admin: aparece SÓ nesta resposta; o banco guarda só o hash. */
export const createdTenantResponse = z.strictObject({
  data: z.strictObject({ tenant: tenantDetailDto, invite: inviteDto, token: z.string() }),
});

// ---------------------------------------------------------------- audit

export const listAuditQuery = cursorQuery.extend({
  tenantId: positiveId.optional(),
  userId: positiveId.optional(),
  entity: z.string().trim().min(1).max(60).optional(),
  action: z.enum(['criacao', 'alteracao', 'exclusao', 'leitura_sensivel', 'aprovacao', 'recusa', 'fechamento', 'reabertura']).optional(),
  ...period,
});

export const auditLogDto = z.strictObject({
  id: z.number(),
  tenantId: z.number().nullable(),
  tenantName: z.string().nullable(),
  userId: z.number().nullable(),
  userEmail: z.string().nullable(),
  entity: z.string(),
  entityId: z.number(),
  action: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
/** `before`/`after` já gravados redigidos (audit.ts `redactAudit`); o service redige de novo por garantia. */
export const auditLogDetailDto = auditLogDto.extend({ before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()).nullable() });

export const auditListResponse = z.strictObject({ data: z.array(auditLogDto), meta: cursorMeta });
export const auditDetailResponse = z.strictObject({ data: auditLogDetailDto });

// ---------------------------------------------------------------- access-logs

export const listSessionsQuery = pagination.extend({
  tenantId: positiveId.optional(),
  userId: positiveId.optional(),
  ip: z.string().trim().min(1).max(64).optional(),
  active: z.stringbool().optional(),
});

export const sessionDto = z.strictObject({
  id: z.number(),
  tenantId: z.number().nullable(),
  tenantName: z.string().nullable(),
  userId: z.number(),
  userEmail: z.string(),
  role: z.string(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string(),
  isActive: z.boolean(),
});
export const sessionListResponse = z.strictObject({ data: z.array(sessionDto), meta: listMeta });

export const LOGIN_STEPS = ['senha', 'totp'] as const;
export const LOGIN_FAILURE_REASONS = ['credencial_invalida', 'usuario_inativo', 'conta_suspensa', 'totp_invalido'] as const;

export const listLoginAttemptsQuery = cursorQuery.extend({
  ip: z.string().trim().min(1).max(64).optional(),
  tenantId: positiveId.optional(),
  success: z.stringbool().optional(),
  ...period,
});
/** Sem e-mail (nem hash): só usuário quando a tentativa casou com um. */
export const loginAttemptDto = z.strictObject({
  id: z.number(),
  tenantId: z.number().nullable(),
  userId: z.number().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  step: z.enum(LOGIN_STEPS),
  success: z.boolean(),
  failureReason: z.enum(LOGIN_FAILURE_REASONS).nullable(),
  createdAt: z.string(),
});
export const loginAttemptListResponse = z.strictObject({ data: z.array(loginAttemptDto), meta: cursorMeta });

export const flaggedIpDto = z.strictObject({
  ipAddress: z.string(),
  failures: z.number(),
  successes: z.number(),
  distinctAccounts: z.number(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  flagged: z.boolean(),
  /** Ex.: `muitas_falhas`, `muitas_contas`. Só sinaliza; nada é bloqueado. */
  reasons: z.array(z.enum(['muitas_falhas', 'muitas_contas'])),
});
export const flaggedIpListResponse = z.strictObject({ data: z.array(flaggedIpDto) });

export const sessionIdParams = z.object({ sessionId: positiveId });
export const userIdParams = z.object({ userId: positiveId });
export const revokeBody = z.object({ reason: reasonText });
export const revokeResponse = z.strictObject({ data: z.strictObject({ revoked: z.number() }) });

// ---------------------------------------------------------------- recognition-logs (só agregados)

export const recognitionQuery = windowQuery.extend({
  tenantId: positiveId.optional(),
  establishmentId: positiveId.optional(),
  deviceId: positiveId.optional(),
});
export const recognitionSeriesQuery = recognitionQuery.extend({ bucket: z.enum(['hour', 'day']).default('hour') });

/** Campos que o arp não tem (dependem do coletor gravar as tentativas): sempre `null` até lá. */
const unavailable = z.null();

export const recognitionSummaryDto = z.strictObject({
  window: z.enum(WINDOWS),
  from: z.string(),
  to: z.string(),
  punches: z.number(),
  byStatus: z.strictObject({ pendente: z.number(), processado: z.number(), falhou: z.number() }),
  divergentClock: z.number(),
  recognitionScore: z.strictObject({ avg: z.number().nullable(), p50: z.number().nullable(), p05: z.number().nullable() }),
  livenessScore: z.strictObject({ avg: z.number().nullable(), p50: z.number().nullable(), p05: z.number().nullable() }),
  /** Histograma de 10 faixas de 0 a 1. */
  livenessHistogram: z.array(z.number()).length(10),
  notRecognized: unavailable,
  livenessFailed: unavailable,
  latencyP50Ms: unavailable,
  latencyP95Ms: unavailable,
});
export const recognitionSummaryResponse = z.strictObject({ data: recognitionSummaryDto });

export const recognitionSeriesResponse = z.strictObject({
  data: z.array(z.strictObject({ bucketStart: z.string(), punches: z.number(), failed: z.number(), avgRecognitionScore: z.number().nullable(), avgLivenessScore: z.number().nullable() })),
});

export const recognitionDevicesResponse = z.strictObject({
  data: z.array(
    z.strictObject({
      tenantId: z.number(),
      establishmentId: z.number(),
      deviceId: z.number(),
      deviceName: z.string().nullable(),
      punches: z.number(),
      failed: z.number(),
      divergentClock: z.number(),
      avgRecognitionScore: z.number().nullable(),
      avgLivenessScore: z.number().nullable(),
      lastPunchAt: z.string().nullable(),
    }),
  ),
});

// ---------------------------------------------------------------- stats

export const moduleUsage = z.strictObject({ adjustments: z.number(), certificates: z.number(), vacations: z.number(), absences: z.number(), closings: z.number() });

export const statsOverviewDto = z.strictObject({
  window: z.enum(WINDOWS),
  tenants: z.strictObject({ total: z.number(), active: z.number(), suspended: z.number() }),
  employees: z.number(),
  devices: z.strictObject({ total: z.number(), active: z.number() }),
  users: z.number(),
  punches: z.number(),
  punchesPerDay: z.array(z.strictObject({ day: z.string(), punches: z.number() })),
  /** Fração 0–1 de batidas `processado` sobre o total da janela; null sem batidas. */
  processedRate: z.number().nullable(),
  pendingClosings: z.number(),
  moduleUsage,
  topTenants: z.array(z.strictObject({ tenantId: z.number(), name: z.string(), punches: z.number(), employees: z.number() })),
});
export const statsOverviewResponse = z.strictObject({ data: statsOverviewDto });

export const tenantStatsDto = z.strictObject({
  tenantId: z.number(),
  window: z.enum(WINDOWS),
  employees: z.number(),
  devices: z.strictObject({ total: z.number(), active: z.number() }),
  users: z.number(),
  punches: z.number(),
  punchesPerDay: z.array(z.strictObject({ day: z.string(), punches: z.number() })),
  processedRate: z.number().nullable(),
  pendingClosings: z.number(),
  moduleUsage,
});
export const tenantStatsResponse = z.strictObject({ data: tenantStatsDto });

export const growthQuery = z.object({ months: z.coerce.number().int().min(1).max(36).default(12) });
export const growthResponse = z.strictObject({
  data: z.array(z.strictObject({ month: z.string(), newTenants: z.number(), totalTenants: z.number(), newEmployees: z.number(), totalEmployees: z.number() })),
});

// ---------------------------------------------------------------- system-health

export const HEALTH_STATES = ['ok', 'degraded', 'down'] as const;
export const HEALTH_SERVICES = ['api', 'postgres_app', 'postgres_arp', 'valkey', 'face_engine', 'collector_api', 'rep_core', 'jobs'] as const;

export const healthCheckDto = z.strictObject({
  service: z.enum(HEALTH_SERVICES),
  status: z.enum(HEALTH_STATES),
  /** null quando o serviço não foi consultado (não configurado). */
  latencyMs: z.number().nullable(),
  /** Frase curta em pt-BR. Nunca mensagem de exceção, URL ou segredo. */
  detail: z.string().nullable(),
  /** Números do check (ex.: `{ waiting: 3, oldestAgeSeconds: 12 }`). Só números. */
  metrics: z.record(z.string(), z.number()).nullable(),
});
export const systemHealthResponse = z.strictObject({
  data: z.strictObject({
    status: z.enum(HEALTH_STATES),
    checkedAt: z.string(),
    version: z.string(),
    uptimeSeconds: z.number(),
    checks: z.array(healthCheckDto),
  }),
});
