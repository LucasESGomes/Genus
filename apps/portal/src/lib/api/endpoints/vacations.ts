/** Férias (apps/api/src/modules/vacations) + [MOCK] calendário por setor. 409 FERIAS_* traz o motivo. */
import type { ApiClient } from '../client';
import type {
  AccrualPeriod, CreateAccrualPeriodBody, EntityId, Envelope, RejectVacationBody, RequestVacationBody, Vacation, VacationCalendar,
} from '../contracts';
import { apiPath } from '../ids';
import { missing } from '../missing';

export interface VacationCalendarQuery {
  establishmentId: EntityId;
  /** AAAA-MM */
  month: string;
  departmentId?: EntityId;
}

export const vacationsApi = (c: ApiClient) => ({
  periods: async (employeeId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<AccrualPeriod[]>>(apiPath`/portal/employees/${employeeId}/vacation-periods`, signal)).data,
  createPeriod: async (employeeId: EntityId, body: CreateAccrualPeriodBody) =>
    (await c.post<Envelope<AccrualPeriod>>(apiPath`/portal/employees/${employeeId}/vacation-periods`, body)).data,
  request: async (employeeId: EntityId, body: RequestVacationBody) =>
    (await c.post<Envelope<Vacation>>(apiPath`/portal/employees/${employeeId}/vacations`, body)).data,
  approve: async (id: EntityId) => (await c.post<Envelope<Vacation>>(apiPath`/portal/vacations/${id}/approve`)).data,
  reject: async (id: EntityId, body: RejectVacationBody) => (await c.post<Envelope<Vacation>>(apiPath`/portal/vacations/${id}/reject`, body)).data,
  /** O back exige motivo (rejectVacationBody: 3 a 500 caracteres). */
  cancel: async (id: EntityId, body: RejectVacationBody) => (await c.post<Envelope<Vacation>>(apiPath`/portal/vacations/${id}/cancel`, body)).data,
  /** [MOCK] GET /portal/vacations/calendar: não existe no back. */
  calendar: (_q: VacationCalendarQuery, _signal?: AbortSignal): Promise<VacationCalendar> => missing(),
});
export type VacationsApi = ReturnType<typeof vacationsApi>;
