/**
 * Cliente do totem web (`/totem`), SEPARADO do RhApi: o aparelho não tem sessão de usuário nem cookie.
 * Autentica com a chave do aparelho (`X-Device-Key`) e informa a versão (`X-Totem-Version`).
 * Rotas: `/portal/totem/*` (api do RH) e `/coletor/totem/*` (api do coletor), ambas na mesma origem (rewrites do Next).
 * Contrato: docs/totem-contrato.md §3.2 e §4.
 */
import { systemClock, type Clock } from '../clock';
import { ApiError, NETWORK_MESSAGE, toApiError } from './errors';
import { normalizeIds } from './ids';
import { createMockKioskApi } from './mocks/kiosk';
import { useMocks } from './mocks/runtime';

export const TOTEM_VERSION = 'web-1';
/**
 * Chave do aparelho no localStorage. EXCEÇÃO DOCUMENTADA à regra de storage do portal: é a credencial do
 * próprio aparelho (como a Visage), não dado de pessoa. Nunca vai para URL, log, título nem mensagem de erro.
 */
export const KIOSK_KEY_STORAGE = 'genus.totem.key';

export interface KioskKeyStore {
  get(): string | null;
  set(key: string): void;
  clear(): void;
}

export const kioskKeyStore: KioskKeyStore = {
  get: () => {
    try {
      return window.localStorage.getItem(KIOSK_KEY_STORAGE);
    } catch {
      return null;
    }
  },
  set: (key) => {
    try {
      window.localStorage.setItem(KIOSK_KEY_STORAGE, key);
    } catch {
      /* armazenamento bloqueado: o aparelho pede a chave de novo na próxima abertura */
    }
  },
  clear: () => {
    try {
      window.localStorage.removeItem(KIOSK_KEY_STORAGE);
    } catch {
      /* idem */
    }
  },
};

/** 8 primeiros caracteres (o RH reconhece a chave pelo prefixo). Nunca a chave inteira. */
export const keyPrefix = (key: string | null) => (key ? key.slice(0, 8) : '');

// --- contratos -----------------------------------------------------------------------------------------------

export interface KioskContext {
  device: { id: string; name: string };
  establishment: { id: string; name: string };
  calibration: { sessionId: string; status: string } | null;
  serverTime: string;
}

export interface EnrollmentResult {
  enrolledAt: string;
  imagesProcessed: number;
}

export type FallbackReason =
  | 'not_recognized'
  | 'liveness_failed'
  | 'no_face'
  | 'multiple_faces'
  | 'engine_unavailable'
  | 'engine_degraded'
  | 'too_many_candidates';

/** Resposta de `POST /coletor/totem/batidas` (mesma de `POST /coletor/batidas`). Sinalizações nunca bloqueiam. */
export type PunchResult =
  | {
      outcome: 'registered';
      receiptId: string;
      jobId: string;
      markedAt: string;
      warnings: string[];
      /** [PEDIDO AO BACK] primeiro nome do colaborador; o contrato atual do coletor não devolve nome. */
      employeeFirstName?: string;
    }
  | { outcome: 'fallback_required'; reason: FallbackReason; warnings: string[] };

export interface PunchJobStatus {
  jobId: string;
  receiptId: string;
  status: 'pendente' | 'processado' | 'falhou';
  nsr: number | null;
  markedAt: string;
  processedAt: string | null;
}

export interface CalibrationSubmitResult {
  status: 'calculada' | 'falhou';
}

export interface KioskApi {
  context(signal?: AbortSignal): Promise<KioskContext>;
  /** multipart: `cpf`, `pin`, `consentAccepted`, `consentTextVersion`, `photos` (1–5). CPF e PIN só no corpo. */
  enroll(form: FormData): Promise<EnrollmentResult>;
  /** multipart: `sessionId`, `genuine` (p1_1.jpg…), `impostor`, `attack`. */
  submitCalibration(form: FormData): Promise<CalibrationSubmitResult>;
  /** multipart: `image`, `deviceSequence`, `capturedAt`. */
  punch(image: Blob, signal?: AbortSignal): Promise<PunchResult>;
  punchJob(jobId: string, signal?: AbortSignal): Promise<PunchJobStatus>;
}

/** Códigos 401 que NÃO significam chave recusada (credencial do colaborador no cadastro). */
const CREDENTIAL_CODES = new Set(['CPF_OU_PIN_INVALIDO']);

/** 401 por chave do aparelho ausente, inválida ou aparelho inativo: o totem volta para a tela da chave. */
export function isKeyRejected(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401 && !CREDENTIAL_CODES.has(e.code);
}

export interface KioskClientOptions {
  fetcher?: typeof fetch;
  keyStore?: KioskKeyStore;
  clock?: Clock;
  version?: string;
  /** Chamado quando a api recusa a chave (401). O app apaga a chave e volta para a tela da chave. */
  onKeyRejected?: () => void;
}

const JOB_ID = /^\d+-\d+$/;

export function createKioskApi(opts: KioskClientOptions = {}): KioskApi {
  if (useMocks()) return createMockKioskApi(opts);
  const { fetcher = (...a: Parameters<typeof fetch>) => fetch(...a), keyStore = kioskKeyStore, clock = systemClock, version = TOTEM_VERSION, onKeyRejected } = opts;
  let lastSequence = 0;

  async function call<T>(path: string, init: { method?: 'GET' | 'POST'; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
    const key = keyStore.get();
    if (!key) {
      onKeyRejected?.();
      throw new ApiError('unauthenticated', 401, 'CHAVE_AUSENTE', 'Este aparelho ainda não tem a chave do totem.');
    }
    let res: Response;
    try {
      res = await fetcher(path, {
        method: init.method ?? 'GET',
        // Sem cookie: o totem é identificado só pela chave.
        credentials: 'omit',
        headers: { accept: 'application/json', 'X-Device-Key': key, 'X-Totem-Version': version },
        body: init.form,
        signal: init.signal,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      throw new ApiError('network', 0, 'NETWORK', NETWORK_MESSAGE);
    }
    if (!res.ok) {
      const err = toApiError(res.status, await res.json().catch(() => null));
      if (isKeyRejected(err)) onKeyRejected?.();
      throw err;
    }
    const body: unknown = await res.json().catch(() => null);
    const data = (typeof body === 'object' && body !== null && 'data' in body ? (body as { data: unknown }).data : body) as unknown;
    return normalizeIds<T>(data);
  }

  return {
    context: (signal) => call<KioskContext>('/portal/totem/context', { signal }),
    enroll: (form) => call<EnrollmentResult>('/portal/totem/facial/enrollments', { method: 'POST', form }),
    submitCalibration: (form) => call<CalibrationSubmitResult>('/portal/totem/calibration', { method: 'POST', form }),
    punch: (image, signal) => {
      // Idempotência do coletor é por (aparelho, deviceSequence): cada batida precisa de uma sequência nova.
      // Milissegundos do relógio, sempre crescente, para sobreviver a recarregar a página.
      lastSequence = Math.max(lastSequence + 1, clock.now().getTime());
      const form = new FormData();
      form.append('deviceSequence', String(lastSequence));
      form.append('capturedAt', clock.now().toISOString());
      form.append('image', image, 'frame.jpg');
      return call<PunchResult>('/coletor/totem/batidas', { method: 'POST', form, signal });
    },
    punchJob: (jobId, signal) => {
      if (!JOB_ID.test(jobId)) return Promise.reject(toApiError(404, { code: 'NOT_FOUND' }));
      return call<PunchJobStatus>(`/coletor/totem/batidas/jobs/${encodeURIComponent(jobId)}`, { signal });
    },
  };
}
