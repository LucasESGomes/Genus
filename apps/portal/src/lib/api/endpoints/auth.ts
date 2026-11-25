/** Sessão (Better Auth em /auth) e GET /me. Senha e código TOTP nunca são guardados nem logados. */
import type { ApiClient } from '../client';
import type { Envelope, Me } from '../contracts';

export interface SignInResult {
  /** true: a conta tem 2FA e falta o código TOTP. */
  twoFactorRequired: boolean;
}

export const authApi = (c: ApiClient) => ({
  me: async (signal?: AbortSignal) => (await c.get<Envelope<Me>>('/auth/whoami', signal)).data,
  signIn: async (email: string, password: string): Promise<SignInResult> => {
    const r = await c.post<{ twoFactorRedirect?: boolean } | null>('/auth/sign-in/email', { email, password });
    return { twoFactorRequired: Boolean(r?.twoFactorRedirect) };
  },
  verifyTotp: async (code: string): Promise<void> => {
    await c.post<unknown>('/auth/two-factor/verify-totp', { code });
  },
  signOut: async (): Promise<void> => {
    await c.post<unknown>('/auth/sign-out');
  },
});
export type AuthApi = ReturnType<typeof authApi>;
