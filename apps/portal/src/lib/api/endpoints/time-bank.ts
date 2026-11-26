/** Banco de horas do RH (apps/api/src/modules/time-bank): saldos, extrato e regra do estabelecimento. */
import { qs, type ApiClient } from '../client';
import type {
  EmployeeTimeBank, EntityId, Envelope, Paged, SaveTimeBankPolicyBody, TimeBankBalanceQuery, TimeBankBalanceRow, TimeBankPolicy,
} from '../contracts';
import { apiPath } from '../ids';

export const timeBankApi = (c: ApiClient) => ({
  balances: (q: TimeBankBalanceQuery, signal?: AbortSignal) =>
    c.get<Paged<TimeBankBalanceRow>>(`/portal/time-bank${qs({ establishmentId: q.establishmentId, q: q.q, page: q.page, pageSize: q.pageSize })}`, signal),
  byEmployee: async (employeeId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<EmployeeTimeBank>>(apiPath`/portal/employees/${employeeId}/time-bank`, signal)).data,
  /** A regra vigente hoje ou a próxima; null = estabelecimento sem regra (nada é lançado). */
  policy: async (establishmentId: EntityId, signal?: AbortSignal) =>
    (await c.get<Envelope<TimeBankPolicy | null>>(apiPath`/portal/establishments/${establishmentId}/time-bank-policy`, signal)).data,
  savePolicy: async (establishmentId: EntityId, body: SaveTimeBankPolicyBody) =>
    (await c.put<Envelope<TimeBankPolicy>>(apiPath`/portal/establishments/${establishmentId}/time-bank-policy`, body)).data,
});
export type TimeBankApi = ReturnType<typeof timeBankApi>;
