'use client';
import { keepPreviousData } from '@tanstack/react-query';
import type { EntityId } from '@/lib/api/contracts';
import type { ListTenantsQuery, StatsWindow, TenantStats } from '@/lib/api/super-admin-contracts';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';

/** Todas as consultas do painel da operação ficam no módulo de cache `admin`, sob a marca `sa`. */
export const useOverview = (window: StatsWindow) =>
  useApiQuery('admin', { sa: 'overview', window }, (api, signal) => api.superAdmin.stats.overview(window, signal), { placeholderData: keepPreviousData });

/** Atualiza a cada 15 s (a api guarda 5 s em cache). */
export const useHealth = () =>
  useApiQuery('admin', { sa: 'health' }, (api, signal) => api.superAdmin.health.get(signal), { refetchInterval: 15_000 });

export const useTenants = (q: ListTenantsQuery) =>
  useApiQuery('admin', { sa: 'tenants', ...q }, (api, signal) => api.superAdmin.tenants.list(q, signal), { placeholderData: keepPreviousData });

export const useTenant = (id: EntityId | null) =>
  useApiQuery('admin', { sa: 'tenant', id }, (api, signal) => (id ? api.superAdmin.tenants.get(id, signal) : Promise.reject(new Error('sem id'))), { enabled: id !== null });

export const useTenantStats = (id: EntityId | null, window: StatsWindow) =>
  useApiQuery<TenantStats>('admin', { sa: 'tenantStats', id, window }, (api, signal) => (id ? api.superAdmin.stats.tenant(id, window, signal) : Promise.reject(new Error('sem id'))), {
    enabled: id !== null,
    placeholderData: keepPreviousData,
  });

export const useUpdateTenant = () =>
  useApiMutation((api, v: { id: EntityId; name: string }) => api.superAdmin.tenants.update(v.id, { name: v.name }), { invalidates: ['admin'] });
export const useSuspendTenant = () =>
  useApiMutation((api, v: { id: EntityId; reason: string }) => api.superAdmin.tenants.suspend(v.id, v.reason), { invalidates: ['admin'] });
export const useReactivateTenant = () =>
  useApiMutation((api, v: { id: EntityId; reason: string }) => api.superAdmin.tenants.reactivate(v.id, v.reason), { invalidates: ['admin'] });
