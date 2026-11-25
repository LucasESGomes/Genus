/**
 * Autenticação do aparelho pela chave (`X-Device-Key`), conferida contra
 * `rh.aparelhos.chave_hash` no banco `app` (papel somente leitura
 * `genus_coletor_leitura`). Contrato: docs/totem-contrato.md §2 e §4.
 *
 * - A chave em claro nunca é gravada nem logada; só o SHA-256 dela circula.
 * - O contexto (conta, estabelecimento, aparelho) vem SEMPRE desta consulta,
 *   nunca do corpo da requisição.
 * - Cache curto em memória evita uma ida ao banco por batida. Efeito colateral
 *   aceito: desativar o aparelho ou trocar a chave vale em até `ttlMs`.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Clock, DeviceAuthenticator, DeviceContext, Logger } from '@genus/shared';
import type { Pool } from 'pg';
import { HttpError } from '../plugins/error-handler';

export const DEVICE_KEY_HEADER = 'x-device-key';

/** Teto do cache; passou disso, descarta o que já venceu e, se preciso, o mais antigo. */
const MAX_CACHE_ENTRIES = 1000;
/** Chave inválida também entra no cache (curto): barra martelada de chutes no banco. */
const DEFAULT_NEGATIVE_TTL_MS = 5_000;
export const MAX_DEVICE_CACHE_TTL_MS = 30_000;

export interface DbDeviceAuthenticatorOptions {
  pool: Pick<Pool, 'query'>;
  clock: Clock;
  logger: Logger;
  /** Validade do acerto no cache. Máximo 30 s. Padrão 30 s. */
  ttlMs?: number;
  negativeTtlMs?: number;
}

interface DeviceRow {
  id: string;
  conta_id: string;
  estabelecimento_id: string;
  chave_hash: Buffer;
  limiar_reconhecimento: number | null;
  limiar_vivacidade: number | null;
}

type CacheEntry = { context: DeviceContext | null; expiresAtMs: number };

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export class DbDeviceAuthenticator implements DeviceAuthenticator {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly negativeTtlMs: number;

  constructor(private readonly opts: DbDeviceAuthenticatorOptions) {
    this.ttlMs = Math.min(opts.ttlMs ?? MAX_DEVICE_CACHE_TTL_MS, MAX_DEVICE_CACHE_TTL_MS);
    this.negativeTtlMs = Math.min(opts.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS, this.ttlMs);
  }

  async resolve(request: { headers: Record<string, string | string[] | undefined> }): Promise<DeviceContext> {
    const header = request.headers[DEVICE_KEY_HEADER];
    const given = typeof header === 'string' ? header.trim() : '';
    if (given === '' || given.length > 256) throw invalidKey();

    const hash = sha256(given);
    const cacheKey = hash.toString('hex');
    const nowMs = this.opts.clock.now().getTime();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) {
      if (!cached.context) throw invalidKey();
      return { ...cached.context };
    }

    const { rows } = await this.opts.pool.query<DeviceRow>(
      `SELECT id, conta_id, estabelecimento_id, chave_hash, limiar_reconhecimento, limiar_vivacidade
         FROM rh.aparelhos
        WHERE chave_hash = $1 AND ativo = true`,
      [hash],
    );
    const row = rows[0];
    // Defesa em profundidade: a busca já foi pelo hash, mas a conferência final é em tempo constante.
    const ok = row !== undefined && row.chave_hash.length === hash.length && timingSafeEqual(row.chave_hash, hash);

    if (!ok) {
      this.remember(cacheKey, null, nowMs + this.negativeTtlMs);
      throw invalidKey();
    }
    const context: DeviceContext = {
      tenantId: Number(row.conta_id),
      establishmentId: Number(row.estabelecimento_id),
      deviceId: Number(row.id),
      recognitionThreshold: row.limiar_reconhecimento,
      livenessThreshold: row.limiar_vivacidade,
    };
    this.remember(cacheKey, context, nowMs + this.ttlMs);
    return { ...context };
  }

  private remember(key: string, context: DeviceContext | null, expiresAtMs: number): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(key)) {
      const nowMs = this.opts.clock.now().getTime();
      for (const [k, v] of this.cache) if (v.expiresAtMs <= nowMs) this.cache.delete(k);
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
    }
    this.cache.set(key, { context, expiresAtMs });
  }
}

/** Mesma resposta para chave ausente, errada ou de aparelho inativo. */
function invalidKey(): HttpError {
  return new HttpError(401, 'CHAVE_APARELHO_INVALIDA', 'Chave do aparelho inválida');
}
