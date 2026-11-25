/**
 * Tipos do painel do super_admin, espelho de apps/api/src/modules/super-admin/contract.ts
 * (docs/prompts/super-admin-contrato.md). Só o coordenador altera este arquivo.
 *
 * IDs viram `EntityId` (string) na borda, como no resto do portal (lib/api/ids.ts).
 * Enumerações ficam em português, como na api. Nenhum tipo aqui carrega CPF, batida individual,
 * dado de saúde, biometria, hash ou token. A única exceção é `temporaryPassword`, só na criação.
 */
import type { EntityId, ListMeta } from './contracts';

export type StatsWindow = '24h' | '7d' | '30d';
export const STATS_WINDOWS: readonly StatsWindow[] = ['24h', '7d', '30d'];

export interface CursorMeta {
  nextCursor: EntityId | null;
  limit: number;
}
export interface CursorPage<T> {
  data: T[];
  meta: CursorMeta;
}
export interface Paged<T> {
  data: T[];
  meta: ListMeta;
}

// ---- tenants
export type TenantStatus = 'ativa' | 'suspensa';

export interface TenantCounts {
  employees: number;
  devices: number;
  users: number;
  establishments: number;
}
export interface Tenant {
  id: EntityId;
  name: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
  suspendedAt: string | null;
  suspensionReason: string | null;
  counts: TenantCounts;
}
export interface TenantCompany {
  id: EntityId;
  legalName: string;
  cnpj: string;
  isActive: boolean;
}
export interface TenantAdmin {
  id: EntityId;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
}
export interface TenantDetail extends Tenant {
  companies: TenantCompany[];
  admins: TenantAdmin[];
  hasCompanyKey: boolean;
}
export interface ListTenantsQuery {
  q?: string;
  status?: TenantStatus;
  page?: number;
  pageSize?: number;
}
export interface CreateTenantInput {
  name: string;
  company: { legalName: string; cnpj: string };
  establishment: { name: string; registrationType: 'CNPJ' | 'CPF' | 'CAEPF'; registration: string; uf: string; municipalityIbge: string };
  admin: { name: string; email: string };
}
export interface CreatedTenant {
  tenant: TenantDetail;
  admin: { id: EntityId; name: string; email: string };
  /** Mostrada uma vez; nunca guardar no estado global, em log ou em storage. */
  temporaryPassword: string;
}

// ---- audit
export type AuditAction = 'criacao' | 'alteracao' | 'exclusao' | 'leitura_sensivel' | 'aprovacao' | 'recusa' | 'fechamento' | 'reabertura';
export interface AuditLog {
  id: EntityId;
  tenantId: EntityId | null;
  tenantName: string | null;
  userId: EntityId | null;
  userEmail: string | null;
  entity: string;
  entityId: EntityId;
  action: AuditAction;
  reason: string | null;
  createdAt: string;
}
export interface AuditLogDetail extends AuditLog {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
export interface ListAuditQuery {
  tenantId?: EntityId;
  userId?: EntityId;
  entity?: string;
  action?: AuditAction;
  from?: string;
  to?: string;
  cursor?: EntityId;
  limit?: number;
}

// ---- access-logs
export interface PortalSession {
  id: EntityId;
  tenantId: EntityId | null;
  tenantName: string | null;
  userId: EntityId;
  userEmail: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
}
export interface ListSessionsQuery {
  tenantId?: EntityId;
  userId?: EntityId;
  ip?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
}
export type LoginStep = 'senha' | 'totp';
export type LoginFailureReason = 'credencial_invalida' | 'usuario_inativo' | 'conta_suspensa' | 'totp_invalido';
export interface LoginAttempt {
  id: EntityId;
  tenantId: EntityId | null;
  userId: EntityId | null;
  ipAddress: string | null;
  userAgent: string | null;
  step: LoginStep;
  success: boolean;
  failureReason: LoginFailureReason | null;
  createdAt: string;
}
export interface ListLoginAttemptsQuery {
  ip?: string;
  tenantId?: EntityId;
  success?: boolean;
  from?: string;
  to?: string;
  cursor?: EntityId;
  limit?: number;
}
export type IpFlagReason = 'muitas_falhas' | 'muitas_contas';
export interface FlaggedIp {
  ipAddress: string;
  failures: number;
  successes: number;
  distinctAccounts: number;
  firstSeenAt: string;
  lastSeenAt: string;
  flagged: boolean;
  reasons: IpFlagReason[];
}

// ---- recognition (só agregados)
export interface RecognitionQuery {
  window?: StatsWindow;
  tenantId?: EntityId;
  establishmentId?: EntityId;
  deviceId?: EntityId;
}
export interface ScoreStats {
  avg: number | null;
  p50: number | null;
  p05: number | null;
}
export interface RecognitionSummary {
  window: StatsWindow;
  from: string;
  to: string;
  punches: number;
  byStatus: { pendente: number; processado: number; falhou: number };
  divergentClock: number;
  recognitionScore: ScoreStats;
  livenessScore: ScoreStats;
  livenessHistogram: number[];
  /** Sempre null até o coletor gravar as tentativas: mostrar "Indisponível (depende do coletor)". */
  notRecognized: null;
  livenessFailed: null;
  latencyP50Ms: null;
  latencyP95Ms: null;
}
export interface RecognitionSeriesPoint {
  bucketStart: string;
  punches: number;
  failed: number;
  avgRecognitionScore: number | null;
  avgLivenessScore: number | null;
}
export interface RecognitionDevice {
  tenantId: EntityId;
  establishmentId: EntityId;
  deviceId: EntityId;
  deviceName: string | null;
  punches: number;
  failed: number;
  divergentClock: number;
  avgRecognitionScore: number | null;
  avgLivenessScore: number | null;
  lastPunchAt: string | null;
}

// ---- stats
export interface ModuleUsage {
  adjustments: number;
  certificates: number;
  vacations: number;
  absences: number;
  closings: number;
}
export interface PunchesPerDay {
  day: string;
  punches: number;
}
export interface StatsOverview {
  window: StatsWindow;
  tenants: { total: number; active: number; suspended: number };
  employees: number;
  devices: { total: number; active: number };
  users: number;
  punches: number;
  punchesPerDay: PunchesPerDay[];
  processedRate: number | null;
  pendingClosings: number;
  moduleUsage: ModuleUsage;
  topTenants: { tenantId: EntityId; name: string; punches: number; employees: number }[];
}
export interface TenantStats {
  tenantId: EntityId;
  window: StatsWindow;
  employees: number;
  devices: { total: number; active: number };
  users: number;
  punches: number;
  punchesPerDay: PunchesPerDay[];
  processedRate: number | null;
  pendingClosings: number;
  moduleUsage: ModuleUsage;
}
export interface GrowthPoint {
  month: string;
  newTenants: number;
  totalTenants: number;
  newEmployees: number;
  totalEmployees: number;
}

// ---- system-health
export type HealthState = 'ok' | 'degraded' | 'down';
export type HealthService = 'api' | 'postgres_app' | 'postgres_arp' | 'valkey' | 'face_engine' | 'collector_api' | 'rep_core' | 'jobs';
export interface HealthCheck {
  service: HealthService;
  status: HealthState;
  latencyMs: number | null;
  detail: string | null;
  metrics: Record<string, number> | null;
}
export interface SystemHealth {
  status: HealthState;
  checkedAt: string;
  version: string;
  uptimeSeconds: number;
  checks: HealthCheck[];
}
