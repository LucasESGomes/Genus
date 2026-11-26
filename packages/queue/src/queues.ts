import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DAY_RECALCULATION_QUEUE, POST_PUNCH_QUEUE, PUNCHES_QUEUE } from './constants.js';
import { dayRecalculationJobOptions, postPunchJobOptions, punchesJobOptions } from './job-options.js';
import type { PostPunchJobData, PunchJobData } from './payloads.js';

export interface QueueFactoryOptions {
  /** Tentativas por job (`QUEUE_ATTEMPTS`). Padrão 5. */
  attempts?: number;
}

/** Fila `punches`: a API e o resgate publicam; o rep-core consome. */
export function createPunchesQueue(
  connection: Redis,
  opts: QueueFactoryOptions = {},
): Queue<PunchJobData> {
  return new Queue<PunchJobData>(PUNCHES_QUEUE, {
    connection,
    defaultJobOptions: punchesJobOptions(opts.attempts),
  });
}

/** Fila `post-punch` (PDF e QR): o rep-core e o resgate publicam; ainda sem consumidor. */
export function createPostPunchQueue(
  connection: Redis,
  opts: QueueFactoryOptions = {},
): Queue<PostPunchJobData> {
  return new Queue<PostPunchJobData>(POST_PUNCH_QUEUE, {
    connection,
    defaultJobOptions: postPunchJobOptions(opts.attempts),
  });
}

/** Fila `day-recalculation`: o rep-core e o resgate publicam `recalculate-day`; a api consome. */
export function createDayRecalculationQueue(
  connection: Redis,
  opts: QueueFactoryOptions = {},
): Queue<PostPunchJobData> {
  return new Queue<PostPunchJobData>(DAY_RECALCULATION_QUEUE, {
    connection,
    defaultJobOptions: dayRecalculationJobOptions(opts.attempts),
  });
}
