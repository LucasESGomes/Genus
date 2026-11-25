import { ApiError, GENERIC_SERVER_MESSAGE, NETWORK_MESSAGE } from '@/lib/api/errors';
import { COPY } from './copy';

export type LoginStep = 'password' | 'totp';

/** Conta bloqueada por tentativas: 429 ou código do back com BLOQUEAD / TOO_MANY. */
export const isLocked = (e: ApiError) => e.status === 429 || /BLOQUEAD|TOO_MANY/i.test(e.code);

/**
 * Mensagem de tela para uma falha de entrada. Genérica de propósito: não revela se o e-mail existe
 * nem repete o que foi digitado.
 */
export function describeLoginError(e: unknown, step: LoginStep): { message: string; restart?: boolean } {
  if (!(e instanceof ApiError)) return { message: GENERIC_SERVER_MESSAGE };
  if (isLocked(e)) return { message: COPY.locked };
  if (e.kind === 'network') return { message: NETWORK_MESSAGE };
  if (e.kind === 'server' || e.kind === 'unavailable') return { message: GENERIC_SERVER_MESSAGE };
  if (step === 'totp') {
    // Sessão de verificação perdida: volta à senha.
    if (e.kind === 'unauthenticated' && /UNAUTH|EXPIRED|SESSION/i.test(e.code)) return { message: COPY.verificationExpired, restart: true };
    return { message: COPY.invalidCode };
  }
  return { message: COPY.invalidCredentials };
}
