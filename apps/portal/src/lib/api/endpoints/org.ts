/** Estabelecimentos do escopo, setores, cargos e centros de custo (apps/api/src/modules/org-units). */
import { qs, type ApiClient } from '../client';
import type {
  CostCenter, CreateCostCenterBody, CreateDepartmentBody, CreateJobTitleBody, Department, EntityId, Envelope, Establishment, JobTitle,
  UpdateCostCenterBody, UpdateDepartmentBody, UpdateJobTitleBody,
} from '../contracts';
import { apiPath } from '../ids';

export const orgApi = (c: ApiClient) => ({
  establishments: async (signal?: AbortSignal) => (await c.get<Envelope<Establishment[]>>('/portal/establishments', signal)).data,
  departments: async (establishmentId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<Department[]>>(`/portal/departments${qs({ establishmentId })}`, signal)).data,
  createDepartment: async (body: CreateDepartmentBody) => (await c.post<Envelope<Department>>('/portal/departments', body)).data,
  updateDepartment: async (id: EntityId, body: UpdateDepartmentBody) => (await c.patch<Envelope<Department>>(apiPath`/portal/departments/${id}`, body)).data,
  jobTitles: async (establishmentId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<JobTitle[]>>(`/portal/job-titles${qs({ establishmentId })}`, signal)).data,
  createJobTitle: async (body: CreateJobTitleBody) => (await c.post<Envelope<JobTitle>>('/portal/job-titles', body)).data,
  updateJobTitle: async (id: EntityId, body: UpdateJobTitleBody) => (await c.patch<Envelope<JobTitle>>(apiPath`/portal/job-titles/${id}`, body)).data,
  costCenters: async (establishmentId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<CostCenter[]>>(`/portal/cost-centers${qs({ establishmentId })}`, signal)).data,
  createCostCenter: async (body: CreateCostCenterBody) => (await c.post<Envelope<CostCenter>>('/portal/cost-centers', body)).data,
  updateCostCenter: async (id: EntityId, body: UpdateCostCenterBody) => (await c.patch<Envelope<CostCenter>>(apiPath`/portal/cost-centers/${id}`, body)).data,
});
export type OrgApi = ReturnType<typeof orgApi>;
