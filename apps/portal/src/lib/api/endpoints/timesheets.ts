/** Apuração (apps/api/src/modules/timesheets): espelho por colaborador e apuração do dia de todos. */
import { qs, type ApiClient } from '../client';
import type {
  DayRecalculateBody, DayRecalculateResult, DayRowPage, DayRowQuery, EntityId, Envelope, PeriodQuery, RecalculateBody, RecalculateResult, TimesheetDay,
} from '../contracts';
import { apiPath } from '../ids';

export const timesheetsApi = (c: ApiClient) => ({
  byEmployee: async (employeeId: EntityId, q: PeriodQuery, signal?: AbortSignal) =>
    (await c.get<Envelope<TimesheetDay[]>>(`${apiPath`/portal/employees/${employeeId}/timesheets`}${qs({ from: q.from, to: q.to })}`, signal)).data,
  /** Recalcula a partir das marcações; as originais não mudam. */
  recalculate: async (employeeId: EntityId, body: RecalculateBody) =>
    (await c.post<Envelope<RecalculateResult>>(apiPath`/portal/employees/${employeeId}/timesheets/recalculate`, body)).data,
  /** A resposta é a própria página (`{ data, meta, counts }`), sem outro envelope. */
  day: (q: DayRowQuery, signal?: AbortSignal) =>
    c.get<DayRowPage>(
      `/portal/timesheets${qs({
        date: q.date, establishmentId: q.establishmentId, departmentId: q.departmentId, status: q.status, q: q.q, page: q.page, pageSize: q.pageSize,
      })}`,
      signal,
    ),
  /** Recalcula o dia de todos os colaboradores do estabelecimento (rh). */
  recalculateDay: async (body: DayRecalculateBody) =>
    (await c.post<Envelope<DayRecalculateResult>>('/portal/timesheets/recalculate', body)).data,
});
export type TimesheetsApi = ReturnType<typeof timesheetsApi>;
