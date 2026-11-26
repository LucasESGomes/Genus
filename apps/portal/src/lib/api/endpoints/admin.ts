/** Feriados (real). [MOCK] usuários e parâmetros da empresa até o back existir. */
import { qs, type ApiClient } from '../client';
import type { CompanySettings, CreateHolidayBody, EntityId, Envelope, Holiday, PortalUser, SetEstablishmentHolidayBody, UpdateHolidayBody } from '../contracts';
import { apiPath } from '../ids';
import { missing } from '../missing';

export const adminApi = (c: ApiClient) => ({
  users: (_signal?: AbortSignal): Promise<PortalUser[]> => missing(),
  companySettings: (_signal?: AbortSignal): Promise<CompanySettings> => missing(),
  holidays: async (establishmentId: EntityId, year: number, signal?: AbortSignal) =>
    (await c.get<Envelope<Holiday[]>>(`/portal/holidays${qs({ establishmentId, year })}`, signal)).data,
  createHoliday: async (body: CreateHolidayBody) => (await c.post<Envelope<Holiday>>('/portal/holidays', body)).data,
  updateHoliday: async (id: EntityId, body: UpdateHolidayBody) => (await c.patch<Envelope<Holiday>>(apiPath`/portal/holidays/${id}`, body)).data,
  deleteHoliday: async (id: EntityId) => {
    await c.del(apiPath`/portal/holidays/${id}`);
  },
  setEstablishmentHoliday: async (establishmentId: EntityId, holidayId: EntityId, body: SetEstablishmentHolidayBody) =>
    (await c.put<Envelope<Holiday>>(apiPath`/portal/establishments/${establishmentId}/holidays/${holidayId}`, body)).data,
});
export type AdminApi = ReturnType<typeof adminApi>;
