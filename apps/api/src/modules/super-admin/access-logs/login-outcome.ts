/**
 * Resultado de uma tentativa de login a partir da resposta do Better Auth (pura, testada por tabela).
 * Sucesso = 2xx. `code` é o campo `code` do corpo de erro. Erro do servidor (5xx) não é tentativa de
 * ninguém: devolve null e nada é gravado.
 */
import type { LOGIN_FAILURE_REASONS, LOGIN_STEPS } from '../../../db/schema/super-admin';

export type LoginStep = (typeof LOGIN_STEPS)[number];
export type LoginFailureReason = (typeof LOGIN_FAILURE_REASONS)[number];

export interface LoginOutcome {
  isSuccess: boolean;
  failureReason: LoginFailureReason | null;
}

export function classifyLoginOutcome(step: LoginStep, status: number, code: string | undefined): LoginOutcome | null {
  if (status >= 200 && status < 300) return { isSuccess: true, failureReason: null };
  if (status >= 500) return null;
  if (code === 'ACCOUNT_SUSPENDED') return { isSuccess: false, failureReason: 'conta_suspensa' };
  if (code === 'USER_INACTIVE') return { isSuccess: false, failureReason: 'usuario_inativo' };
  return { isSuccess: false, failureReason: step === 'totp' ? 'totp_invalido' : 'credencial_invalida' };
}
