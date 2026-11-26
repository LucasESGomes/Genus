/** Estabelecimentos do escopo (real). [MOCK] setores, cargos e centros de custo: o back não tem estas rotas. */
import type { ApiClient } from '../client';
import type { EntityId, Envelope, Establishment, OrgUnit } from '../contracts';
import { missing } from '../missing';

export const orgApi = (c: ApiClient) => ({
  establishments: async (signal?: AbortSignal) => (await c.get<Envelope<Establishment[]>>('/portal/establishments', signal)).data,
  departments: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<OrgUnit[]> => missing(),
  jobTitles: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<OrgUnit[]> => missing(),
  costCenters: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<OrgUnit[]> => missing(),
});
export type OrgApi = ReturnType<typeof orgApi>;
