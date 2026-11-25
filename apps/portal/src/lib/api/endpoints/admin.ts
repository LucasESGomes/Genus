/** [MOCK] Relatórios e Configurações: sem back. As telas são prévias; gerar/salvar ficam desabilitados. */
import type { ApiClient } from '../client';
import type { CompanySettings, EntityId, Holiday, PortalUser } from '../contracts';
import { missing } from '../missing';

export const adminApi = (_c: ApiClient) => ({
  users: (_signal?: AbortSignal): Promise<PortalUser[]> => missing(),
  companySettings: (_signal?: AbortSignal): Promise<CompanySettings> => missing(),
  holidays: (_establishmentId: EntityId, _year: number, _signal?: AbortSignal): Promise<Holiday[]> => missing(),
});
export type AdminApi = ReturnType<typeof adminApi>;
