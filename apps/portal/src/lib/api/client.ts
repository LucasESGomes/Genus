/**
 * Cliente central da api do RH. Nenhuma tela chama fetch direto: tudo passa por `api`.
 * Mesma origem (o Next repassa /portal, /auth e /me), cookie de sessão httpOnly.
 */
import { ApiError, GENERIC_SERVER_MESSAGE, toApiError } from './errors';

export type Fetcher = typeof fetch;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export function createApiClient(fetcher: Fetcher = (...a) => fetch(...a), baseUrl = '') {
  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetcher(`${baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        credentials: 'include',
        headers: opts.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError('network', 0, 'NETWORK', GENERIC_SERVER_MESSAGE);
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw toApiError(res.status, body);
    return body as T;
  }
  return {
    request,
    get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
