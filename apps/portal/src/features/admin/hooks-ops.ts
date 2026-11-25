'use client';
/** Consultas das telas de auditoria, acessos, reconhecimento e perfil do painel da operação (módulo de cache `admin`, marca `sa`). */
import { keepPreviousData, useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ApiError } from '@/lib/api/errors';
import type { EntityId } from '@/lib/api/contracts';
import type { RhApi } from '@/lib/api/rh';
import type {
  AuditLog, CursorPage, ListAuditQuery, ListLoginAttemptsQuery, ListSessionsQuery, LoginAttempt, RecognitionQuery, StatsWindow,
} from '@/lib/api/super-admin-contracts';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useScopeKey, useSession } from '@/lib/session';

/** Consulta paginada por cursor (`meta.nextCursor`). Cada página nova é buscada com "Carregar mais". */
function useApiInfinite<T>(params: Record<string, unknown>, fn: (api: RhApi, cursor: EntityId | undefined, signal: AbortSignal) => Promise<CursorPage<T>>, enabled = true) {
  const { api } = useSession();
  const scope = useScopeKey();
  const queryKey = useMemo(() => [...scope, 'admin', params] as const, [scope, params]);
  return useInfiniteQuery<CursorPage<T>, ApiError, InfiniteData<CursorPage<T>, EntityId | undefined>, readonly unknown[], EntityId | undefined>({
    queryKey,
    queryFn: ({ pageParam, signal }) => fn(api, pageParam, signal),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    enabled,
  });
}

export const PAGE_LIMIT = 25;

export const useAuditLogs = (q: Omit<ListAuditQuery, 'cursor' | 'limit'>, enabled = true) =>
  useApiInfinite<AuditLog>({ sa: 'audit', ...q }, (api, cursor, signal) => api.superAdmin.audit.list({ ...q, ...(cursor ? { cursor } : {}), limit: PAGE_LIMIT }, signal), enabled);

export const useAuditDetail = (id: EntityId | null) =>
  useApiQuery('admin', { sa: 'auditDetail', id }, (api, signal) => (id ? api.superAdmin.audit.get(id, signal) : Promise.reject(new Error('sem id'))), { enabled: id !== null });

/** Contas para o filtro: até 100, sem busca. */
export const useTenantOptions = () =>
  useApiQuery('admin', { sa: 'tenantOptions' }, (api, signal) => api.superAdmin.tenants.list({ pageSize: 100 }, signal), { staleTime: 60_000 });

export const useSessions = (q: ListSessionsQuery) =>
  useApiQuery('admin', { sa: 'sessions', ...q }, (api, signal) => api.superAdmin.access.sessions(q, signal), { placeholderData: keepPreviousData });

export const useLoginAttempts = (q: Omit<ListLoginAttemptsQuery, 'cursor' | 'limit'>, enabled = true) =>
  useApiInfinite<LoginAttempt>({ sa: 'loginAttempts', ...q }, (api, cursor, signal) => api.superAdmin.access.loginAttempts({ ...q, ...(cursor ? { cursor } : {}), limit: PAGE_LIMIT }, signal), enabled);

export const useFlaggedIps = (window: StatsWindow) =>
  useApiQuery('admin', { sa: 'flaggedIps', window }, (api, signal) => api.superAdmin.access.flaggedIps(window, signal), { placeholderData: keepPreviousData });

export const useRevokeSession = () =>
  useApiMutation((api, v: { id: EntityId; reason: string }) => api.superAdmin.access.revokeSession(v.id, v.reason), { invalidates: ['admin'] });
export const useRevokeUserSessions = () =>
  useApiMutation((api, v: { userId: EntityId; reason: string }) => api.superAdmin.access.revokeUserSessions(v.userId, v.reason), { invalidates: ['admin'] });

export const useRecognitionSummary = (q: RecognitionQuery) =>
  useApiQuery('admin', { sa: 'recognitionSummary', ...q }, (api, signal) => api.superAdmin.recognition.summary(q, signal), { placeholderData: keepPreviousData });
export const useRecognitionSeries = (q: RecognitionQuery & { bucket: 'hour' | 'day' }) =>
  useApiQuery('admin', { sa: 'recognitionSeries', ...q }, (api, signal) => api.superAdmin.recognition.series(q, signal), { placeholderData: keepPreviousData });
export const useRecognitionDevices = (q: RecognitionQuery) =>
  useApiQuery('admin', { sa: 'recognitionDevices', ...q }, (api, signal) => api.superAdmin.recognition.devices(q, signal), { placeholderData: keepPreviousData });
