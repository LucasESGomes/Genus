/**
 * `req.device` a partir do header `X-Device-Key` (totem web, sem sessão de usuário).
 *
 * A chave chega em claro, vira SHA-256 e é buscada por `chave_hash`; o hash achado ainda passa por
 * `timingSafeEqual`. Chave ausente, malformada, desconhecida ou de aparelho inativo dão a MESMA
 * resposta (401 CHAVE_APARELHO_INVALIDA): quem testa chaves não aprende nada. O tenant e o
 * estabelecimento vêm do aparelho, nunca do corpo nem da query.
 *
 * Limite de chaves inválidas por IP em memória do processo ([A CONFIRMAR]: por instância; com a api
 * replicada, mover para o Valkey). O header nunca é logado (o serializador do `req` não o inclui).
 */
import type { Clock } from '@genus/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, preHandlerAsyncHookHandler } from 'fastify';
import type { Database } from '../db/client';
import { devices } from '../db/schema';
import { AttemptLimiter } from '../http/attempt-limiter';
import { DEVICE_KEY_SHAPE, hashDeviceKey, sameHash } from '../modules/devices/key';
import { HttpError } from './error-handler';

export interface DeviceContext {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    device: DeviceContext | null;
  }
  interface FastifyInstance {
    /** preHandler: 401 CHAVE_APARELHO_INVALIDA sem chave válida de aparelho ativo; preenche `req.device`. */
    authenticateDevice: preHandlerAsyncHookHandler;
  }
}

const invalidKey = () => new HttpError(401, 'CHAVE_APARELHO_INVALIDA', 'Chave do aparelho inválida');

export interface DeviceAuthOptions {
  db: Database;
  clock: Clock;
  /** Chaves inválidas por IP antes do 429 (padrão 10 em 15 min). */
  maxFailures?: number;
}

export function registerDeviceAuth(app: FastifyInstance, o: DeviceAuthOptions): void {
  app.decorateRequest('device', null);
  const limiter = new AttemptLimiter(o.clock, o.maxFailures ?? 10);

  const authenticateDevice: preHandlerAsyncHookHandler = async function (req) {
    limiter.assertAllowed(req.ip);
    const raw = req.headers['x-device-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!DEVICE_KEY_SHAPE.test(key)) {
      limiter.fail(req.ip);
      throw invalidKey();
    }
    const hash = hashDeviceKey(key);
    const [row] = await o.db
      .select({ tenantId: devices.tenantId, establishmentId: devices.establishmentId, id: devices.id, isActive: devices.isActive, keyHash: devices.keyHash })
      .from(devices)
      .where(and(eq(devices.keyHash, hash)))
      .limit(1);
    if (!row || !row.keyHash || !sameHash(row.keyHash, hash) || !row.isActive) {
      limiter.fail(req.ip);
      throw invalidKey();
    }
    req.device = { tenantId: Number(row.tenantId), establishmentId: Number(row.establishmentId), deviceId: Number(row.id) };
  };
  app.decorate('authenticateDevice', authenticateDevice);
}
