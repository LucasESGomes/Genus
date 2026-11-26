/**
 * Painel do super_admin (apps/api, docs/prompts/super-admin-contrato.md). Rotas sob /portal/super-admin.
 * Respostas só com agregados e metadados: nada de CPF, batida individual, dado de saúde ou hash.
 * O token do convite (criação de conta) e os códigos de recuperação do 2FA aparecem uma vez e nunca são guardados aqui.
 */
import { qs, type ApiClient } from '../client';
import type { EntityId, Envelope, ListMeta } from '../contracts';
import { apiPath } from '../ids';
import type {
  AuditLog, AuditLogDetail, CreatedTenant, CreateTenantInput, CursorPage, FlaggedIp, GrowthPoint, ListAuditQuery, ListLoginAttemptsQuery,
  ListSessionsQuery, ListTenantsQuery, LoginAttempt, Paged, PortalSession, RecognitionDevice, RecognitionQuery, RecognitionSeriesPoint,
  RecognitionSummary, StatsOverview, StatsWindow, SystemHealth, Tenant, TenantDetail, TenantStats,
} from '../super-admin-contracts';

const BASE = '/portal/super-admin';

interface CursorEnvelope<T> {
  data: T[];
  meta: { nextCursor: EntityId | number | null; limit: number };
}
interface PagedEnvelope<T> {
  data: T[];
  meta: ListMeta;
}

/** `nextCursor` não é chave de ID para o normalizador: vira string aqui, na borda. */
const toCursorPage = <T>(r: CursorEnvelope<T>): CursorPage<T> => ({
  data: r.data,
  meta: { nextCursor: r.meta.nextCursor == null ? null : String(r.meta.nextCursor), limit: r.meta.limit },
});

export const superAdminApi = (c: ApiClient) => ({
  tenants: {
    list: async (q: ListTenantsQuery, signal?: AbortSignal): Promise<Paged<Tenant>> => {
      const r = await c.get<PagedEnvelope<Tenant>>(`${BASE}/tenants${qs({ q: q.q, status: q.status, page: q.page, pageSize: q.pageSize })}`, signal);
      return { data: r.data, meta: r.meta };
    },
    get: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<TenantDetail>>(apiPath`/portal/super-admin/tenants/${id}`, signal)).data,
    create: async (input: CreateTenantInput) => (await c.post<Envelope<CreatedTenant>>(`${BASE}/tenants`, input)).data,
    update: async (id: EntityId, input: { name: string }) => (await c.patch<Envelope<TenantDetail>>(apiPath`/portal/super-admin/tenants/${id}`, input)).data,
    suspend: async (id: EntityId, reason: string) => (await c.post<Envelope<TenantDetail>>(apiPath`/portal/super-admin/tenants/${id}/suspend`, { reason })).data,
    reactivate: async (id: EntityId, reason: string) => (await c.post<Envelope<TenantDetail>>(apiPath`/portal/super-admin/tenants/${id}/reactivate`, { reason })).data,
  },
  audit: {
    list: async (q: ListAuditQuery, signal?: AbortSignal): Promise<CursorPage<AuditLog>> =>
      toCursorPage(await c.get<CursorEnvelope<AuditLog>>(
        `${BASE}/audit-logs${qs({ tenantId: q.tenantId, userId: q.userId, entity: q.entity, action: q.action, from: q.from, to: q.to, cursor: q.cursor, limit: q.limit })}`, signal)),
    get: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<AuditLogDetail>>(apiPath`/portal/super-admin/audit-logs/${id}`, signal)).data,
  },
  access: {
    sessions: async (q: ListSessionsQuery, signal?: AbortSignal): Promise<Paged<PortalSession>> => {
      const r = await c.get<PagedEnvelope<PortalSession>>(
        `${BASE}/access/sessions${qs({ tenantId: q.tenantId, userId: q.userId, ip: q.ip, active: q.active, page: q.page, pageSize: q.pageSize })}`, signal);
      return { data: r.data, meta: r.meta };
    },
    loginAttempts: async (q: ListLoginAttemptsQuery, signal?: AbortSignal): Promise<CursorPage<LoginAttempt>> =>
      toCursorPage(await c.get<CursorEnvelope<LoginAttempt>>(
        `${BASE}/access/login-attempts${qs({ ip: q.ip, tenantId: q.tenantId, success: q.success, from: q.from, to: q.to, cursor: q.cursor, limit: q.limit })}`, signal)),
    flaggedIps: async (window: StatsWindow, signal?: AbortSignal) => (await c.get<Envelope<FlaggedIp[]>>(`${BASE}/access/flagged-ips${qs({ window })}`, signal)).data,
    revokeSession: async (id: EntityId, reason: string) => (await c.post<Envelope<{ revoked: number }>>(apiPath`/portal/super-admin/access/sessions/${id}/revoke`, { reason })).data,
    revokeUserSessions: async (userId: EntityId, reason: string) =>
      (await c.post<Envelope<{ revoked: number }>>(apiPath`/portal/super-admin/access/users/${userId}/revoke-sessions`, { reason })).data,
  },
  recognition: {
    summary: async (q: RecognitionQuery, signal?: AbortSignal) =>
      (await c.get<Envelope<RecognitionSummary>>(`${BASE}/recognition/summary${recognitionQs(q)}`, signal)).data,
    series: async (q: RecognitionQuery & { bucket: 'hour' | 'day' }, signal?: AbortSignal) =>
      (await c.get<Envelope<RecognitionSeriesPoint[]>>(`${BASE}/recognition/series${recognitionQs(q, { bucket: q.bucket })}`, signal)).data,
    devices: async (q: RecognitionQuery, signal?: AbortSignal) =>
      (await c.get<Envelope<RecognitionDevice[]>>(`${BASE}/recognition/devices${recognitionQs(q)}`, signal)).data,
  },
  stats: {
    overview: async (window: StatsWindow, signal?: AbortSignal) => (await c.get<Envelope<StatsOverview>>(`${BASE}/stats/overview${qs({ window })}`, signal)).data,
    tenant: async (id: EntityId, window: StatsWindow, signal?: AbortSignal) =>
      (await c.get<Envelope<TenantStats>>(apiPath`/portal/super-admin/stats/tenants/${id}` + qs({ window }), signal)).data,
    growth: async (months: number, signal?: AbortSignal) => (await c.get<Envelope<GrowthPoint[]>>(`${BASE}/stats/growth${qs({ months })}`, signal)).data,
  },
  health: {
    get: async (signal?: AbortSignal) => (await c.get<Envelope<SystemHealth>>(`${BASE}/system-health`, signal)).data,
  },
  /** Better Auth (/auth/two-factor/*). A senha e os códigos passam por aqui e não ficam em lugar nenhum. */
  auth2fa: {
    enable: (password: string) => c.post<{ totpURI: string; backupCodes: string[] }>('/auth/two-factor/enable', { password }),
    verify: async (code: string): Promise<void> => {
      await c.post<unknown>('/auth/two-factor/verify-totp', { code });
    },
  },
});
export type SuperAdminApi = ReturnType<typeof superAdminApi>;

function recognitionQs(q: RecognitionQuery, extra: Record<string, string> = {}) {
  return qs({ window: q.window, tenantId: q.tenantId, establishmentId: q.establishmentId, deviceId: q.deviceId, ...extra });
}
