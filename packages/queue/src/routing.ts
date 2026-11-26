/**
 * Fila de cada evento do outbox, num só lugar: rep-core e resgate publicam pela mesma regra.
 * `recalculate-day` tem fila própria porque tem consumidor (um worker do BullMQ recebe tudo
 * o que está na fila dele); os demais seguem em `post-punch`. Payload e `jobId` não mudam.
 */
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { DAY_RECALCULATION_QUEUE, POST_PUNCH_QUEUE, RECALCULATE_DAY_EVENT, type PostPunchEvent } from './constants.js';
import type { PostPunchJobData } from './payloads.js';
import { createDayRecalculationQueue, createPostPunchQueue, type QueueFactoryOptions } from './queues.js';

export type OutboxEventQueueName = typeof POST_PUNCH_QUEUE | typeof DAY_RECALCULATION_QUEUE;

export function queueNameForEvent(event: PostPunchEvent): OutboxEventQueueName {
  return event === RECALCULATE_DAY_EVENT ? DAY_RECALCULATION_QUEUE : POST_PUNCH_QUEUE;
}

export interface OutboxEventQueues {
  /** A fila em que o evento é publicado. */
  forEvent(event: PostPunchEvent): Queue<PostPunchJobData>;
  /** Todas, para registrar ouvintes de erro e fechar. */
  all: readonly Queue<PostPunchJobData>[];
}

export function createOutboxEventQueues(connection: Redis, opts: QueueFactoryOptions = {}): OutboxEventQueues {
  const queues: Record<OutboxEventQueueName, Queue<PostPunchJobData>> = {
    [POST_PUNCH_QUEUE]: createPostPunchQueue(connection, opts),
    [DAY_RECALCULATION_QUEUE]: createDayRecalculationQueue(connection, opts),
  };
  return {
    forEvent: (event) => queues[queueNameForEvent(event)],
    all: Object.values(queues),
  };
}
