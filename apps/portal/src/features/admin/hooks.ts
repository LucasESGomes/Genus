'use client';
import { keepPreviousData } from '@tanstack/react-query';
import type { EntityId } from '@/lib/api/contracts';
import type { CreateCompanyInput, CreateEstablishmentInput, UpdateCompanyInput, UpdateEstablishmentInput } from '@/lib/api/organization-contracts';
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

export const useCompanies = (tenantId: EntityId) =>
  useApiQuery('admin', { sa: 'companies', tenantId }, (api, signal) => api.organization.companies(tenantId, signal));

type SaveCompany = { tenantId: EntityId } & ({ create: CreateCompanyInput } | { id: EntityId; patch: UpdateCompanyInput });
export const useSaveCompany = () =>
  useApiMutation(
    (api, v: SaveCompany) => ('create' in v ? api.organization.createCompany(v.tenantId, v.create) : api.organization.updateCompany(v.tenantId, v.id, v.patch)),
    { invalidates: ['admin'] },
  );

type SaveEstablishment = { tenantId: EntityId } & ({ companyId: EntityId; create: CreateEstablishmentInput } | { id: EntityId; patch: UpdateEstablishmentInput });
export const useSaveEstablishment = () =>
  useApiMutation(
    (api, v: SaveEstablishment) => ('create' in v ? api.organization.createEstablishment(v.tenantId, v.companyId, v.create) : api.organization.updateEstablishment(v.tenantId, v.id, v.patch)),
    { invalidates: ['admin'] },
  );
