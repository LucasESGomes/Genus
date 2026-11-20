import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { POST_PUNCH_QUEUE, PUNCHES_QUEUE } from './constants.js';
import { postPunchJobOptions, punchesJobOptions } from './job-options.js';
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

/** Fila `post-punch`: o rep-core e o resgate publicam; sem consumidor nesta rodada. */
export function createPostPunchQueue(
  connection: Redis,
  opts: QueueFactoryOptions = {},
): Queue<PostPunchJobData> {
  return new Queue<PostPunchJobData>(POST_PUNCH_QUEUE, {
    connection,
    defaultJobOptions: postPunchJobOptions(opts.attempts),
  });
}
