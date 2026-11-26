/** Visão geral (G11): GET /portal/overview. */
import { qs, type ApiClient } from '../client';
import type { EntityId, Envelope, Overview } from '../contracts';

export const overviewApi = (c: ApiClient) => ({
  get: async (establishmentId: EntityId, period: { from?: string; to?: string }, signal?: AbortSignal) =>
    (await c.get<Envelope<Overview>>(`/portal/overview${qs({ establishmentId, from: period.from, to: period.to })}`, signal)).data,
});
export type OverviewApi = ReturnType<typeof overviewApi>;
