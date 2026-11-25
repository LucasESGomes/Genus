/** Erro da api traduzido para o que a tela mostra. Nunca carrega stack nem corpo cru. */
export type ApiErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'server'
  | 'network'
  /** Endpoint que o back ainda não tem, com mocks desligados: a tela mostra "Em breve". */
  | 'unavailable';

export interface FieldError {
  path: string;
  message: string;
}

export const GENERIC_SERVER_MESSAGE = 'Não foi possível concluir agora. Tente de novo em alguns segundos.';
export const NETWORK_MESSAGE = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
export const UNAVAILABLE_MESSAGE = 'Esta parte ainda está em construção no servidor.';
/** 403 e 404 mostram a MESMA mensagem: não confirmar que o recurso existe (defesa contra IDOR). */
export const HIDDEN_RESOURCE_MESSAGE = 'Não encontramos este item ou você não tem acesso a ele.';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function kindOf(status: number): ApiErrorKind {
  if (status === 400 || status === 422) return 'validation';
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  return 'server';
}

/** Monta o ApiError a partir do envelope `{ error, code, details? }` da api. */
export function toApiError(status: number, body: unknown): ApiError {
  const kind = kindOf(status);
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === 'string' ? b.code : `HTTP_${status}`;
  // 5xx: mensagem genérica, sempre. O texto do servidor não chega à tela.
  if (kind === 'server') return new ApiError(kind, status, code, GENERIC_SERVER_MESSAGE);
  if (kind === 'forbidden' || kind === 'not_found') return new ApiError(kind, status, code, HIDDEN_RESOURCE_MESSAGE);
  const message = typeof b.error === 'string' ? b.error : GENERIC_SERVER_MESSAGE;
  const fields = Array.isArray(b.details)
    ? b.details.filter((d): d is FieldError => typeof d?.path === 'string' && typeof d?.message === 'string')
    : [];
  return new ApiError(kind, status, code, message, fields);
}

export const unavailableError = () => new ApiError('unavailable', 0, 'EM_BREVE', UNAVAILABLE_MESSAGE);

/** 403 ou 404: a tela usa o mesmo estado ("não encontrado ou sem acesso"). */
export const isHiddenResource = (e: unknown) => e instanceof ApiError && (e.kind === 'forbidden' || e.kind === 'not_found');

/** Qualquer erro → ApiError (AbortError é relançado por quem chama). */
export function asApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('server', 0, 'UNKNOWN', GENERIC_SERVER_MESSAGE);
}
