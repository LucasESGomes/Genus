/**
 * Autenticação por chave do aparelho (`X-Device-Key`) para o escopo
 * `/coletor/totem/*`. Sem chave de serviço: o navegador do totem não pode
 * guardar segredo de serviço. A chave NUNCA é logada.
 */
import type { DeviceAuthenticator, DeviceContext, Logger } from '@genus/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError } from './error-handler';

export interface DeviceKeyAuthOptions {
  deviceAuthenticator: DeviceAuthenticator;
  logger: Logger;
}

export function registerDeviceKeyAuth(scope: FastifyInstance, opts: DeviceKeyAuthOptions): void {
  scope.addHook('onRequest', async (req) => {
    try {
      const context: DeviceContext = await opts.deviceAuthenticator.resolve({ headers: req.headers });
      req.deviceContext = context;
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) {
        opts.logger.warn({ ip: req.ip, method: req.method, url: req.url }, 'auth: chave do aparelho ausente ou inválida');
      }
      throw err;
    }
  });
}
