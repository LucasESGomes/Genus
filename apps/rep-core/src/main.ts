/**
 * Processo do rep-core: consome `punches` e atribui NSR (sem HTTP).
 * Composição das dependências reais e encerramento limpo em SIGTERM/SIGINT.
 */
import { createProducerConnection, createWorkerConnection } from '@genus/queue';
import { createLogger, SystemClock } from '@genus/shared';
import pg from 'pg';
import { loadRepCoreConfig, RepCoreConfigError } from './config/env.js';
import { createPostPunchPublisher } from './worker/post-punch-publisher.js';
import { startPunchWorker } from './worker/punch-worker.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadRepCoreConfig();
  } catch (err) {
    const bootLogger = createLogger({ level: 'error', service: 'rep-core' });
    // A mensagem de RepCoreConfigError lista só nomes de variáveis.
    bootLogger.fatal(
      { event: 'config_invalid', message: err instanceof RepCoreConfigError ? err.message : 'erro desconhecido' },
      'rep-core: configuração inválida',
    );
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel, service: 'rep-core' });
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.poolMax });
  // Erro em conexão ociosa do pool derrubaria o processo sem este ouvinte.
  pool.on('error', (err) => {
    logger.warn({ event: 'pool_error', err: { name: err.name } }, 'rep-core: erro em conexão ociosa do banco');
  });

  const workerConnection = createWorkerConnection(config.queue);
  const producerConnection = createProducerConnection(config.queue);
  const publisher = createPostPunchPublisher({
    connection: producerConnection,
    logger,
    timeoutMs: config.queue.publishTimeoutMs,
    attempts: config.queue.attempts,
  });
  workerConnection.on('error', (err) => {
    logger.warn({ event: 'queue_connection_error', err: { name: err.name } }, 'rep-core: erro de conexão com o Valkey (consumo)');
  });

  const worker = startPunchWorker({
    pool,
    clock: new SystemClock(),
    logger,
    connection: workerConnection,
    publisher,
    concurrency: config.concurrency,
    attempts: config.queue.attempts,
  });
  logger.info(
    { event: 'rep_core_started', concurrency: config.concurrency, poolMax: config.poolMax, appEnv: config.appEnv },
    'rep-core: consumindo a fila punches',
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'rep_core_stopping', signal }, 'rep-core: encerrando');
    try {
      // Ordem: para de consumir e espera os jobs ativos (eles ainda usam pool e publicador).
      await worker.close();
      await publisher.close();
      producerConnection.disconnect();
      workerConnection.disconnect();
      await pool.end();
      logger.info({ event: 'rep_core_stopped' }, 'rep-core: encerrado');
    } catch (err) {
      logger.error({ event: 'rep_core_stop_failed', err: { name: err instanceof Error ? err.name : 'unknown' } }, 'rep-core: falha ao encerrar');
      process.exitCode = 1;
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
