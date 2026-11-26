/** Empresas e estabelecimentos de uma conta, pelo super_admin (/portal/super-admin/tenants/:tenantId). Não há DELETE. */
import type { ApiClient } from '../client';
import type { EntityId, Envelope } from '../contracts';
import { apiPath } from '../ids';
import type { Company, CompanyEstablishment, CreateCompanyInput, CreateEstablishmentInput, UpdateCompanyInput, UpdateEstablishmentInput } from '../organization-contracts';

export const organizationApi = (c: ApiClient) => ({
  companies: async (tenantId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<Company[]>>(apiPath`/portal/super-admin/tenants/${tenantId}/companies`, signal)).data,
  createCompany: async (tenantId: EntityId, input: CreateCompanyInput) =>
    (await c.post<Envelope<Company>>(apiPath`/portal/super-admin/tenants/${tenantId}/companies`, input)).data,
  updateCompany: async (tenantId: EntityId, companyId: EntityId, input: UpdateCompanyInput) =>
    (await c.patch<Envelope<Company>>(apiPath`/portal/super-admin/tenants/${tenantId}/companies/${companyId}`, input)).data,
  createEstablishment: async (tenantId: EntityId, companyId: EntityId, input: CreateEstablishmentInput) =>
    (await c.post<Envelope<CompanyEstablishment>>(apiPath`/portal/super-admin/tenants/${tenantId}/companies/${companyId}/establishments`, input)).data,
  updateEstablishment: async (tenantId: EntityId, establishmentId: EntityId, input: UpdateEstablishmentInput) =>
    (await c.patch<Envelope<CompanyEstablishment>>(apiPath`/portal/super-admin/tenants/${tenantId}/establishments/${establishmentId}`, input)).data,
});
export type OrganizationApi = ReturnType<typeof organizationApi>;
