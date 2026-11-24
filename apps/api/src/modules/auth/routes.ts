/**
 * Ponte Fastify → Better Auth: toda requisição em /auth/* vira um `Request` web e
 * vai para `auth.handler`. Rotas usadas pelo portal (todas do Better Auth):
 *
 *   POST /auth/sign-in/email          e-mail + senha → cookie (ou { twoFactorRedirect })
 *   POST /auth/two-factor/verify-totp segundo fator → cookie
 *   POST /auth/two-factor/enable      gera o segredo TOTP (pede a senha)
 *   POST /auth/sign-out               encerra a sessão
 *   GET  /auth/get-session            sessão atual
 *   GET  /auth/token                  JWT curto (precisa de sessão)
 *   GET  /auth/jwks                   chave pública do JWT
 *
 * O cadastro público (/auth/sign-up/email) está desligado na configuração.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { AUTH_BASE_PATH, CLIENT_IP_HEADER, type Auth } from './auth';

export function toWebRequest(req: FastifyRequest, baseURL: string): Request {
  const headers = fromNodeHeaders(req.headers);
  // O IP para o limite de tentativas é o que o Fastify vê, nunca um header do cliente.
  headers.set(CLIENT_IP_HEADER, req.ip);
  // baseURL é só a origem (env.ts garante); req.url já traz /auth/...
  const target = new URL(req.url, baseURL);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined && req.body !== null;
  return new Request(target, {
    method: req.method,
    headers,
    body: hasBody ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : undefined,
  });
}

export async function sendWebResponse(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.status(response.status);
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() !== 'set-cookie') reply.header(key, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  const text = await response.text();
  return reply.send(text.length > 0 ? text : null);
}

export async function authRoutes(app: FastifyInstance, opts: { auth: Auth; baseURL: string }): Promise<void> {
  app.route({
    method: ['GET', 'POST'],
    url: `${AUTH_BASE_PATH}/*`,
    schema: { hide: true },
    handler: async (req, reply) => sendWebResponse(reply, await opts.auth.handler(toWebRequest(req, opts.baseURL))),
  });
}
