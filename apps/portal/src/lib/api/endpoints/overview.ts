/** [MOCK] Visão geral: GET /portal/overview não existe no back. */
import type { ApiClient } from '../client';
import type { EntityId, Overview } from '../contracts';
import { missing } from '../missing';

export const overviewApi = (_c: ApiClient) => ({
  get: (_establishmentId: EntityId, _signal?: AbortSignal): Promise<Overview> => missing(),
});
export type OverviewApi = ReturnType<typeof overviewApi>;
