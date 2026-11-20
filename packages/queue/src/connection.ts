import { Redis } from 'ioredis';
import type { QueueConfig } from './config.js';

function passwordOption(config: Pick<QueueConfig, 'password'>) {
  return config.password !== undefined ? { password: config.password } : {};
}

/**
 * Conexão de PUBLICAÇÃO (API, resgate, worker ao publicar).
 *
 * - `enableOfflineQueue: false`: com o Valkey fora, o ioredis falha na hora em
 *   vez de enfileirar o comando na memória e deixar `add()` pendurado. A batida
 *   já está no banco; publicar é opcional e não pode segurar a resposta.
 * - Timeouts curtos (`QUEUE_PUBLISH_TIMEOUT_MS`): a publicação roda no caminho
 *   da resposta ao aparelho.
 */
export function createProducerConnection(
  config: Pick<QueueConfig, 'url' | 'password' | 'publishTimeoutMs'>,
): Redis {
  return new Redis(config.url, {
    ...passwordOption(config),
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: config.publishTimeoutMs,
    commandTimeout: config.publishTimeoutMs,
    // Reconecta em segundo plano com espera crescente (teto de 2 s).
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
}

/** Conexão de CONSUMO (Worker): comandos bloqueantes exigem `maxRetriesPerRequest: null`. */
export function createWorkerConnection(config: Pick<QueueConfig, 'url' | 'password'>): Redis {
  return new Redis(config.url, {
    ...passwordOption(config),
    maxRetriesPerRequest: null,
  });
}
