/** Escalas (apps/api/src/modules/schedules). Avisos só avisam: nunca bloqueiam (art. 74). */
import { qs, type ApiClient } from '../client';
import type {
  AssignScheduleBody, CreateScheduleBody, EmployeeSchedule, EntityId, Envelope, Schedule, ScheduleListQuery, ScheduleSummary, UpdateScheduleBody,
} from '../contracts';
import { apiPath } from '../ids';

export const schedulesApi = (c: ApiClient) => ({
  list: async (q: ScheduleListQuery, signal?: AbortSignal) =>
    (await c.get<Envelope<ScheduleSummary[]>>(`/portal/schedules${qs({ establishmentId: q.establishmentId, q: q.q })}`, signal)).data,
  get: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<Schedule>>(apiPath`/portal/schedules/${id}`, signal)).data,
  create: async (body: CreateScheduleBody) => (await c.post<Envelope<Schedule>>('/portal/schedules', body)).data,
  update: async (id: EntityId, body: UpdateScheduleBody) => (await c.patch<Envelope<Schedule>>(apiPath`/portal/schedules/${id}`, body)).data,
  employeeSchedules: async (employeeId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<EmployeeSchedule[]>>(apiPath`/portal/employees/${employeeId}/schedules`, signal)).data,
  assign: async (employeeId: EntityId, body: AssignScheduleBody) =>
    (await c.post<Envelope<EmployeeSchedule>>(apiPath`/portal/employees/${employeeId}/schedules`, body)).data,
});
export type SchedulesApi = ReturnType<typeof schedulesApi>;
