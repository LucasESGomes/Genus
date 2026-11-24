/** Chamadas do painel de RH. Endpoints sem back respondem mock quando NEXT_PUBLIC_USE_MOCKS=true. */
import { createApiClient, type ApiClient } from './client';
import type { Envelope, Establishment, Me, Overview } from './contracts';
import { mockEstablishments, mockMe, mockOverview, useMocks } from './mocks';

export function createRhApi(client: ApiClient = createApiClient(), mocks = useMocks()) {
  return {
    me: async (signal?: AbortSignal) => (mocks ? mockMe : (await client.get<Envelope<Me>>('/me', signal)).data),
    establishments: async (signal?: AbortSignal) =>
      mocks ? mockEstablishments : (await client.get<Envelope<Establishment[]>>('/portal/establishments', signal)).data,
    overview: async (establishmentId: number, signal?: AbortSignal) =>
      mocks ? mockOverview : (await client.get<Envelope<Overview>>(`/portal/overview?establishmentId=${establishmentId}`, signal)).data,
  };
}

export type RhApi = ReturnType<typeof createRhApi>;
