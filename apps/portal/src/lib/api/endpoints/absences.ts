/** Afastamentos (apps/api/src/modules/absences). Para admin/gestor: "afastado", nunca diagnóstico. */
import type { ApiClient } from '../client';
import type { Absence, CreateAbsenceBody, EntityId, Envelope } from '../contracts';
import { apiPath } from '../ids';

export const absencesApi = (c: ApiClient) => ({
  list: async (employeeId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<Absence[]>>(apiPath`/portal/employees/${employeeId}/absences`, signal)).data,
  create: async (employeeId: EntityId, body: CreateAbsenceBody) =>
    (await c.post<Envelope<Absence>>(apiPath`/portal/employees/${employeeId}/absences`, body)).data,
});
export type AbsencesApi = ReturnType<typeof absencesApi>;
