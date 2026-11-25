/** Apuração (apps/api/src/modules/timesheets) + [MOCK] apuração do dia de todos. */
import { qs, type ApiClient } from '../client';
import type { DayRowPage, DayRowQuery, EntityId, Envelope, PeriodQuery, RecalculateBody, RecalculateResult, TimesheetDay } from '../contracts';
import { apiPath } from '../ids';
import { missing } from '../missing';

export const timesheetsApi = (c: ApiClient) => ({
  byEmployee: async (employeeId: EntityId, q: PeriodQuery, signal?: AbortSignal) =>
    (await c.get<Envelope<TimesheetDay[]>>(`${apiPath`/portal/employees/${employeeId}/timesheets`}${qs({ from: q.from, to: q.to })}`, signal)).data,
  /** Recalcula a partir das marcações; as originais não mudam. */
  recalculate: async (employeeId: EntityId, body: RecalculateBody) =>
    (await c.post<Envelope<RecalculateResult>>(apiPath`/portal/employees/${employeeId}/timesheets/recalculate`, body)).data,
  /** [MOCK] GET /portal/timesheets?date&establishmentId…: não existe no back. */
  day: (_q: DayRowQuery, _signal?: AbortSignal): Promise<DayRowPage> => missing(),
});
export type TimesheetsApi = ReturnType<typeof timesheetsApi>;
