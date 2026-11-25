/** [MOCK] Estabelecimentos, setores, cargos e centros de custo: o back não tem estas rotas. */
import type { ApiClient } from '../client';
import type { EntityId, Establishment, OrgUnit } from '../contracts';
import { missing } from '../missing';

export const orgApi = (_c: ApiClient) => ({
  establishments: (_signal?: AbortSignal): Promise<Establishment[]> => missing(),
  departments: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<OrgUnit[]> => missing(),
  jobTitles: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<OrgUnit[]> => missing(),
  costCenters: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<OrgUnit[]> => missing(),
});
export type OrgApi = ReturnType<typeof orgApi>;
