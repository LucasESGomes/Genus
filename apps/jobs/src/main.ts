/**
 * Processo de resgate (`apps/jobs`). A cada `RESCUE_INTERVAL_MS` republica o que ficou
 * pendente no banco e não chegou à fila. Lê com `arp_reader`; nunca escreve no banco.
 */
import { createPostPunchQueue, createProducerConnection, createPunchesQueue } from '@genus/queue';
import { createLogger, startHeartbeat, SystemClock } from '@genus/shared';
import pg from 'pg';
import { JobsConfigError, loadJobsConfig } from './config.js';
import { runRescueOnce } from './rescue.js';

/**
 * Prazo dos comandos do resgate. Maior que o da API (250 ms): aqui não há aparelho
 * esperando resposta e uma varredura de 500 itens não deve falhar por um soluço.
 */
const RESCUE_COMMAND_TIMEOUT_MS = 2000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadJobsConfig();
  } catch (err) {
    const bootLogger = createLogger({ level: 'error', service: 'jobs' });
    // A mensagem de JobsConfigError lista só nomes de variáveis.
    bootLogger.fatal(
      { event: 'config_invalid', message: err instanceof JobsConfigError ? err.message : 'erro desconhecido' },
      'jobs: configuração inválida',
    );
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel, service: 'jobs' });
  const clock = new SystemClock();
  const reader = new pg.Pool({ connectionString: config.databaseUrl, max: 2 });
  reader.on('error', (err) => {
    logger.warn({ event: 'pool_error', err: { name: err.name } }, 'jobs: erro em conexão ociosa do banco');
  });

  const connection = createProducerConnection({
    url: config.valkeyUrl,
    password: config.valkeyPassword,
    publishTimeoutMs: RESCUE_COMMAND_TIMEOUT_MS,
  });
  connection.on('error', (err) => {
    logger.warn({ event: 'queue_connection_error', err: { name: err.name } }, 'jobs: erro de conexão com o Valkey');
  });
  const punchesQueue = createPunchesQueue(connection, { attempts: config.attempts });
  const postPunchQueue = createPostPunchQueue(connection, { attempts: config.attempts });
  const onQueueError = (err: Error) => {
    logger.warn({ event: 'queue_error', err: { name: err.name } }, 'jobs: erro na fila');
  };
  punchesQueue.on('error', onQueueError);
  postPunchQueue.on('error', onQueueError);

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();
  let wake: (() => void) | undefined;

  /** Sem fila offline, comando antes do `ready` falha: espera a conexão (até 5 s) antes da rodada. */
  const waitReady = async (): Promise<void> => {
    if (connection.status === 'ready') return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(t);
        connection.off('ready', done);
        resolve();
      };
      const t = setTimeout(done, 5000);
      connection.once('ready', done);
    });
  };

  const round = async (): Promise<void> => {
    try {
      await waitReady();
      await runRescueOnce({
        reader,
        clock,
        logger,
        punchesQueue,
        postPunchQueue,
        minAgeMs: config.minAgeMs,
        postPunchDepthWarn: config.postPunchDepthWarn,
      });
    } catch (err) {
      // Erro de uma rodada (Valkey fora, banco fora) não derruba o processo: tenta na próxima.
      logger.error(
        { event: 'rescue_round_failed', err: { name: err instanceof Error ? err.name : 'unknown' } },
        'jobs: rodada de resgate falhou; nova tentativa no próximo intervalo',
      );
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      await round();
      if (stopped) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, config.intervalMs);
      });
    }
  };

  logger.info(
    { event: 'jobs_started', intervalMs: config.intervalMs, minAgeMs: config.minAgeMs, appEnv: config.appEnv },
    'jobs: resgate iniciado',
  );
  running = loop();
  // Sinal de vida para o healthcheck do contêiner (só vale com HEARTBEAT_FILE definido).
  const stopHeartbeat = startHeartbeat({
    file: process.env['HEARTBEAT_FILE'],
    isHealthy: () => connection.status === 'ready',
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ event: 'jobs_stopping', signal }, 'jobs: encerrando');
    stopped = true;
    stopHeartbeat();
    clearTimeout(timer);
    wake?.();
    try {
      await running; // deixa a rodada em andamento terminar
      await Promise.allSettled([punchesQueue.close(), postPunchQueue.close()]);
      connection.disconnect();
      await reader.end();
      logger.info({ event: 'jobs_stopped' }, 'jobs: encerrado');
    } catch (err) {
      logger.error({ event: 'jobs_stop_failed', err: { name: err instanceof Error ? err.name : 'unknown' } }, 'jobs: falha ao encerrar');
      process.exitCode = 1;
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
