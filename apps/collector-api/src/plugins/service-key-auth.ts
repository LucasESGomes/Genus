/**
 * Autenticação por chave de serviço (header `X-Service-Key`) e resolução do
 * contexto do aparelho. Aplica-se ao escopo em que for registrado (/coletor/*).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { DeviceAuthenticator, DeviceContext, Logger } from '@genus/shared';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo hook de autenticação; nunca vem do corpo. */
    deviceContext?: DeviceContext;
  }
}

export interface ServiceKeyAuthOptions {
  serviceKeys: string[];
  deviceAuthenticator: DeviceAuthenticator;
  logger: Logger;
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Compara em tempo constante: SHA-256 de ambos (tamanhos iguais) e
 * `timingSafeEqual`, percorrendo TODAS as chaves sem atalho.
 */
export function isValidServiceKey(given: string, digests: Buffer[]): boolean {
  const givenDigest = sha256(given);
  let ok = false;
  for (const digest of digests) {
    if (timingSafeEqual(givenDigest, digest)) ok = true;
  }
  return ok;
}

export function registerServiceKeyAuth(scope: FastifyInstance, opts: ServiceKeyAuthOptions): void {
  const digests = opts.serviceKeys.map(sha256);

  scope.addHook('onRequest', async (req, reply) => {
    const header = req.headers['x-service-key'];
    const given = typeof header === 'string' ? header : '';
    if (!isValidServiceKey(given, digests)) {
      opts.logger.warn(
        { ip: req.ip, method: req.method, url: req.url },
        'auth: chave de serviço ausente ou inválida',
      );
      return reply.code(401).send({ error: 'Não autorizado', code: 'UNAUTHORIZED' });
    }
    req.deviceContext = await opts.deviceAuthenticator.resolve({ headers: req.headers });
  });
}
