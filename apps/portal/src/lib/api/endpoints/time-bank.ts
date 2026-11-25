/** [MOCK] Banco de horas do RH: o back só tem /me/time-bank (colaborador). */
import type { ApiClient } from '../client';
import type { EmployeeTimeBank, EntityId, Paged, PaginationQuery, TimeBankBalanceRow } from '../contracts';
import { missing } from '../missing';

export const timeBankApi = (_c: ApiClient) => ({
  balances: (_q: PaginationQuery & { establishmentId: EntityId; q?: string }, _signal?: AbortSignal): Promise<Paged<TimeBankBalanceRow>> => missing(),
  byEmployee: (_employeeId: EntityId, _signal?: AbortSignal): Promise<EmployeeTimeBank> => missing(),
});
export type TimeBankApi = ReturnType<typeof timeBankApi>;
