/**
 * Índice cego do e-mail das tentativas de login (`tentativas_login.email_hash`).
 * HMAC-SHA256 do e-mail em minúsculas e sem espaços, com chave derivada do segredo do Better Auth
 * (HKDF-SHA256, sal 'genus', info 'login-attempt-email'). Serve só para contar e-mails distintos por IP:
 * o e-mail em claro nunca é gravado nem logado.
 */
import { createHmac, hkdfSync } from 'node:crypto';

export function deriveEmailHashKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'genus', 'login-attempt-email', 32));
}

export function hashLoginEmail(key: Buffer, email: string): Buffer {
  return createHmac('sha256', key).update(email.trim().toLowerCase()).digest();
}
