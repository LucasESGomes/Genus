/** Escalas (apps/api/src/modules/schedules). Avisos só avisam: nunca bloqueiam (art. 74). */
import { qs, type ApiClient } from '../client';
import type {
  AssignScheduleBody, CreateScheduleBody, CreateScheduleOverrideBody, EmployeeSchedule, EntityId, Envelope, Schedule, ScheduleListQuery, ScheduleMember,
  ScheduleOverride, ScheduleSummary, SwitchScheduleBody, UpdateScheduleBody,
} from '../contracts';
import { apiPath } from '../ids';

export const schedulesApi = (c: ApiClient) => ({
  list: async (q: ScheduleListQuery, signal?: AbortSignal) =>
    (await c.get<Envelope<ScheduleSummary[]>>(`/portal/schedules${qs({ establishmentId: q.establishmentId, q: q.q, status: q.status })}`, signal)).data,
  get: async (id: EntityId, signal?: AbortSignal) => (await c.get<Envelope<Schedule>>(apiPath`/portal/schedules/${id}`, signal)).data,
  create: async (body: CreateScheduleBody) => (await c.post<Envelope<Schedule>>('/portal/schedules', body)).data,
  update: async (id: EntityId, body: UpdateScheduleBody) => (await c.patch<Envelope<Schedule>>(apiPath`/portal/schedules/${id}`, body)).data,
  employeeSchedules: async (employeeId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<EmployeeSchedule[]>>(apiPath`/portal/employees/${employeeId}/schedules`, signal)).data,
  assign: async (employeeId: EntityId, body: AssignScheduleBody) =>
    (await c.post<Envelope<EmployeeSchedule>>(apiPath`/portal/employees/${employeeId}/schedules`, body)).data,
  /** Encerra (ou reabre, com null) o vínculo com a escala. */
  endAssignment: async (employeeId: EntityId, assignmentId: EntityId, validTo: string | null) =>
    (await c.patch<Envelope<EmployeeSchedule>>(apiPath`/portal/employees/${employeeId}/schedules/${assignmentId}`, { validTo })).data,
  switchSchedule: async (employeeId: EntityId, body: SwitchScheduleBody) =>
    (await c.post<Envelope<EmployeeSchedule>>(apiPath`/portal/employees/${employeeId}/schedules/switch`, body)).data,
  members: async (scheduleId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<ScheduleMember[]>>(apiPath`/portal/schedules/${scheduleId}/employees`, signal)).data,
  overrides: async (employeeId: EntityId, from: string, to: string, signal?: AbortSignal) =>
    (await c.get<Envelope<ScheduleOverride[]>>(`${apiPath`/portal/employees/${employeeId}/schedule-overrides`}${qs({ from, to })}`, signal)).data,
  createOverride: async (employeeId: EntityId, body: CreateScheduleOverrideBody) =>
    (await c.post<Envelope<ScheduleOverride>>(apiPath`/portal/employees/${employeeId}/schedule-overrides`, body)).data,
  deleteOverride: async (employeeId: EntityId, overrideId: EntityId) => {
    await c.del(apiPath`/portal/employees/${employeeId}/schedule-overrides/${overrideId}`);
  },
});
export type SchedulesApi = ReturnType<typeof schedulesApi>;
