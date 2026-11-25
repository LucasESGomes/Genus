import { describe, expect, it } from 'vitest';
import { classifyLoginOutcome, type LoginStep } from './login-outcome';

describe('classifyLoginOutcome', () => {
  it.each([
    ['senha', 200, undefined, { isSuccess: true, failureReason: null }],
    ['totp', 200, undefined, { isSuccess: true, failureReason: null }],
    ['senha', 401, 'INVALID_EMAIL_OR_PASSWORD', { isSuccess: false, failureReason: 'credencial_invalida' }],
    ['senha', 400, undefined, { isSuccess: false, failureReason: 'credencial_invalida' }],
    ['senha', 401, 'ACCOUNT_SUSPENDED', { isSuccess: false, failureReason: 'conta_suspensa' }],
    ['senha', 401, 'USER_INACTIVE', { isSuccess: false, failureReason: 'usuario_inativo' }],
    ['totp', 401, 'INVALID_CODE', { isSuccess: false, failureReason: 'totp_invalido' }],
    ['totp', 401, undefined, { isSuccess: false, failureReason: 'totp_invalido' }],
    ['totp', 401, 'ACCOUNT_SUSPENDED', { isSuccess: false, failureReason: 'conta_suspensa' }],
    ['senha', 500, undefined, null],
    ['totp', 503, 'X', null],
  ] as [LoginStep, number, string | undefined, unknown][])('%s %i %s', (step, status, code, expected) => {
    expect(classifyLoginOutcome(step, status, code)).toEqual(expected);
  });
});
