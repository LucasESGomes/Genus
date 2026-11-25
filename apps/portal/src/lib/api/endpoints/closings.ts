/** Fechamento e espelhos (apps/api/src/modules/closing). Reabrir apaga a ciência: diálogo forte. */
import { qs, type ApiClient } from '../client';
import type { Closing, CreateClosingBody, EntityId, Envelope, GenerateMirrorsResult, ListClosingsQuery, Mirror, ReopenClosingBody } from '../contracts';
import { apiPath } from '../ids';

export const closingsApi = (c: ApiClient) => ({
  list: async (q: ListClosingsQuery, signal?: AbortSignal) =>
    (await c.get<Envelope<Closing[]>>(`/portal/closings${qs({ establishmentId: q.establishmentId })}`, signal)).data,
  create: async (body: CreateClosingBody) => (await c.post<Envelope<Closing>>('/portal/closings', body)).data,
  close: async (id: EntityId) => (await c.post<Envelope<Closing>>(apiPath`/portal/closings/${id}/close`)).data,
  reopen: async (id: EntityId, body: ReopenClosingBody) => (await c.post<Envelope<Closing>>(apiPath`/portal/closings/${id}/reopen`, body)).data,
  generateMirrors: async (id: EntityId) => (await c.post<Envelope<GenerateMirrorsResult>>(apiPath`/portal/closings/${id}/mirrors`)).data,
  mirror: async (id: EntityId, employeeId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<Mirror>>(apiPath`/portal/closings/${id}/mirrors/${employeeId}`, signal)).data,
});
export type ClosingsApi = ReturnType<typeof closingsApi>;
