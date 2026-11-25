/**
 * QueryClient do portal. Cache só em memória (nada de persistência: dado de saúde e CPF não vão
 * para storage). Sem retry em 4xx e em "Em breve"; um retry em rede/5xx.
 */
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/errors';

const NO_RETRY = new Set(['validation', 'unauthenticated', 'forbidden', 'not_found', 'conflict', 'unavailable']);

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (count, e) => !(e instanceof ApiError && NO_RETRY.has(e.kind)) && count < 1,
      },
      mutations: { retry: false },
    },
  });
}

/** QueryClient de teste: sem retry, sem cache entre testes. */
export function makeTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } } });
}
