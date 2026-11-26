/**
 * Worker de `day-recalculation`. Fica aqui para o consumidor (processo da api) não depender
 * do BullMQ direto: este pacote é o único que conhece a biblioteca da fila.
 */
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { DAY_RECALCULATION_QUEUE } from './constants.js';

/** Erro que não adianta repetir (ex.: payload inválido). */
export { UnrecoverableError } from 'bullmq';
export type { Job as QueueJob } from 'bullmq';

export interface DayRecalculationWorkerOptions {
  /** Jobs em paralelo. Padrão 1. */
  concurrency?: number;
}

export function createDayRecalculationWorker(
  /** Conexão de `createWorkerConnection` (`maxRetriesPerRequest: null`). */
  connection: Redis,
  processor: (job: Job<unknown>) => Promise<void>,
  opts: DayRecalculationWorkerOptions = {},
): Worker<unknown, void> {
  return new Worker<unknown, void>(DAY_RECALCULATION_QUEUE, processor, {
    connection,
    concurrency: opts.concurrency ?? 1,
  });
}
