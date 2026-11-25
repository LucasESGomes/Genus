/**
 * Cliente central da api do RH. Nenhuma tela chama fetch direto: tudo passa por aqui.
 * Mesma origem (o Next repassa /portal, /auth e /me), cookie de sessão httpOnly.
 * Respostas JSON passam por `normalizeIds` (IDs viram string opaca, ver ids.ts).
 */
import { normalizeIds } from './ids';
import { ApiError, NETWORK_MESSAGE, toApiError } from './errors';

export type Fetcher = typeof fetch;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** multipart: o navegador põe o content-type com boundary. */
  form?: FormData;
  signal?: AbortSignal;
}

export type QueryValue = string | number | boolean | null | undefined;

/** Query string sem valores vazios. Nunca use para CPF, e-mail, nome ou dado de saúde. */
export function qs(params: Record<string, QueryValue>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function createApiClient(fetcher: Fetcher = (...a) => fetch(...a), baseUrl = '') {
  async function send(path: string, opts: RequestOptions, accept: string): Promise<Response> {
    const headers: Record<string, string> = { accept };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetcher(`${baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        credentials: 'include',
        headers,
        body: opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
        signal: opts.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError('network', 0, 'NETWORK', NETWORK_MESSAGE);
    }
    if (!res.ok) throw toApiError(res.status, await res.json().catch(() => null));
    return res;
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await send(path, opts, 'application/json');
    if (res.status === 204) return undefined as T;
    const body: unknown = await res.json().catch(() => null);
    return normalizeIds<T>(body);
  }

  /** Arquivo protegido (atestado, foto). Quem chama abre com URL.createObjectURL e REVOGA depois. */
  async function blob(path: string, signal?: AbortSignal): Promise<Blob> {
    return (await send(path, { signal }, '*/*')).blob();
  }

  return {
    request,
    blob,
    get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body ?? {} }),
    patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
    put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
    del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
    postForm: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', form }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

