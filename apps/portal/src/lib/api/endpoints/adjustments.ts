/** Ajustes (apps/api/src/modules/adjustments). Aprovar ACRESCENTA: a marcação original nunca muda. */
import { qs, type ApiClient } from '../client';
import type { Adjustment, AdjustmentListQuery, ApproveAdjustmentBody, CreateAdjustmentBody, EntityId, Envelope, Paged, RejectAdjustmentBody } from '../contracts';
import { apiPath } from '../ids';

export const adjustmentsApi = (c: ApiClient) => ({
  list: (q: AdjustmentListQuery, signal?: AbortSignal) =>
    c.get<Paged<Adjustment>>(`/portal/adjustments${qs({ status: q.status, employeeId: q.employeeId, q: q.q, page: q.page, pageSize: q.pageSize })}`, signal),
  create: async (employeeId: EntityId, body: CreateAdjustmentBody) =>
    (await c.post<Envelope<Adjustment>>(apiPath`/portal/employees/${employeeId}/adjustments`, body)).data,
  approve: async (id: EntityId, body: ApproveAdjustmentBody) =>
    (await c.post<Envelope<Adjustment>>(apiPath`/portal/adjustments/${id}/approve`, body)).data,
  reject: async (id: EntityId, body: RejectAdjustmentBody) =>
    (await c.post<Envelope<Adjustment>>(apiPath`/portal/adjustments/${id}/reject`, body)).data,
});
export type AdjustmentsApi = ReturnType<typeof adjustmentsApi>;
