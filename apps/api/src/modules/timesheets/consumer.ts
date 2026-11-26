/**
 * Consumidor da fila `day-recalculation`, dentro do processo da api: o worker e o
 * agendamento do `close-days`. Com o Valkey fora, a api segue no ar; o worker
 * reconecta sozinho e o resgate (apps/jobs) republica o que não chegou à fila.
 */
import {
  CLOSE_DAYS_JOB_NAME,
  createDayRecalculationQueue,
  createDayRecalculationWorker,
  createProducerConnection,
  createWorkerConnection,
  DEFAULT_ATTEMPTS,
  postPunchPayloadSchema,
  RECALCULATE_DAY_EVENT,
  UnrecoverableError,
  type QueueJob,
} from '@genus/queue';
import { AutoRecalculationService, type AutoRecalculationDeps } from './auto-recalculation';
import { describeError } from './describe-error';

export const CLOSE_DAYS_EVERY_MS = 60 * 60 * 1000;
/** Jobs em paralelo: o pool do banco é dividido com as requisições HTTP. */
const CONCURRENCY = 2;
const CLOSE_TIMEOUT_MS = 10_000;
const SCHEDULER_COMMAND_TIMEOUT_MS = 5000;

export interface DayRecalculationConsumerOptions extends AutoRecalculationDeps {
  /** `url` sem senha; a senha vai separada. */
  valkey: { url: string; password: string | null };
}

export interface DayRecalculationConsumer {
  /** Para de consumir, espera os jobs ativos (até 10 s) e fecha as conexões. */
  close(): Promise<void>;
}

export function createDayRecalculationProcessor(deps: AutoRecalculationDeps): (job: QueueJob<unknown>) => Promise<void> {
  const service = new AutoRecalculationService(deps);

  return async function process(job) {
    let run: () => Promise<unknown>;
    if (job.name === CLOSE_DAYS_JOB_NAME) {
      run = () => service.closeDays();
    } else if (job.name === RECALCULATE_DAY_EVENT) {
      const parsed = postPunchPayloadSchema.safeParse(job.data);
      if (!parsed.success) {
        deps.logger.error(
          { event: 'day_recalculation_payload_invalid', jobId: job.id ?? null, fields: parsed.error.issues.map((i) => i.path.join('.')) },
          'apuração: payload de job inválido',
        );
        throw new UnrecoverableError('payload inválido');
      }
      const { tenantId, establishmentId, nsr } = parsed.data;
      run = () => service.recalculateForPunch({ tenantId, establishmentId, nsr });
    } else {
      deps.logger.warn({ event: 'day_recalculation_unknown_job', jobId: job.id ?? null }, 'apuração: job desconhecido; ignorado');
      return;
    }

    try {
      await run();
    } catch (err) {
      const error = describeError(err);
      const attempt = job.attemptsMade + 1;
      const exhausted = attempt >= (job.opts.attempts ?? DEFAULT_ATTEMPTS);
      deps.logger[exhausted ? 'error' : 'warn'](
        { event: exhausted ? 'day_recalculation_failed' : 'day_recalculation_retry', jobId: job.id ?? null, jobName: job.name, attempt, err: error },
        exhausted ? 'apuração: tentativas esgotadas; recalcule o dia pelo portal' : 'apuração: erro; a fila fará nova tentativa',
      );
      // Erro novo, só com nome e código: o original não vai para o Valkey. Sem `cause`, de propósito.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`${error.name}${error.code ? ` ${error.code}` : ''}`);
    }
  };
}

export function startDayRecalculation(options: DayRecalculationConsumerOptions): DayRecalculationConsumer {
  const { logger } = options;
  const config = { url: options.valkey.url, password: options.valkey.password ?? undefined };
  const workerConnection = createWorkerConnection(config);
  const schedulerConnection = createProducerConnection({ ...config, publishTimeoutMs: SCHEDULER_COMMAND_TIMEOUT_MS });

  // Uma linha por queda, só com nome e código (a mensagem do ioredis pode citar host e porta).
  let errorLogged = false;
  const onError = (err: Error) => {
    if (errorLogged) return;
    errorLogged = true;
    logger.warn({ event: 'queue_connection_error', err: describeError(err) }, 'apuração: erro na fila (Valkey)');
  };
  workerConnection.on('error', onError);
  schedulerConnection.on('error', onError);

  const worker = createDayRecalculationWorker(workerConnection, createDayRecalculationProcessor(options), { concurrency: CONCURRENCY });
  worker.on('error', onError);
  const queue = createDayRecalculationQueue(schedulerConnection);
  queue.on('error', onError);

  // A cada conexão: repetir é inofensivo e recria o agendamento se o Valkey perdeu os dados.
  schedulerConnection.on('ready', () => {
    errorLogged = false;
    queue
      .upsertJobScheduler(CLOSE_DAYS_JOB_NAME, { every: CLOSE_DAYS_EVERY_MS }, { name: CLOSE_DAYS_JOB_NAME })
      .catch((err: unknown) => {
        logger.warn({ event: 'close_days_schedule_failed', err: describeError(err) }, 'apuração: não foi possível agendar o encerramento de dias');
      });
  });
  logger.info({ event: 'day_recalculation_started', concurrency: CONCURRENCY }, 'apuração: consumindo a fila day-recalculation');

  return {
    async close() {
      const finished = await settlesWithin(worker.close(), CLOSE_TIMEOUT_MS);
      if (!finished) {
        logger.warn({ event: 'day_recalculation_close_timeout' }, 'apuração: o worker não fechou no prazo; a fila reentrega o job');
        await settlesWithin(worker.disconnect(), 1000);
      }
      await settlesWithin(queue.close(), 2000);
      // Ouvinte mudo até o fim, para um erro tardio não derrubar o processo.
      for (const c of [workerConnection, schedulerConnection]) {
        c.on('error', () => undefined);
        c.disconnect();
      }
    },
  };
}

/** true se `work` terminou (bem ou mal) dentro do prazo. */
async function settlesWithin(work: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true,
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
