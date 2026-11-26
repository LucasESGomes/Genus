import type { JobsOptions } from 'bullmq';
import { DAY_RECALCULATION_KEEP_COMPLETED_SECONDS } from './constants.js';

export const DEFAULT_ATTEMPTS = 5;

/** Opções comuns às filas (`removeOnComplete` é de cada fila). */
export function defaultJobOptions(attempts: number = DEFAULT_ATTEMPTS) {
  return {
    attempts,
    backoff: { type: 'exponential' as const, delay: 1000 },
    removeOnFail: false as const,
  };
}

export const DEFAULT_JOB_OPTIONS = defaultJobOptions();

/** `punches`: concluídos saem em 24 h ou ao passar de 10 mil. Falhos ficam (reprocessáveis). */
export function punchesJobOptions(attempts: number = DEFAULT_ATTEMPTS): JobsOptions {
  return { ...defaultJobOptions(attempts), removeOnComplete: { age: 86_400, count: 10_000 } };
}

/** `post-punch`: concluídos ficam; o consumidor futuro marca o outbox e só então remove. */
export function postPunchJobOptions(attempts: number = DEFAULT_ATTEMPTS): JobsOptions {
  return { ...defaultJobOptions(attempts), removeOnComplete: false };
}

/** `day-recalculation`: concluídos ficam 48 h (o resgate não republica job `completed`). Falhos ficam. */
export function dayRecalculationJobOptions(attempts: number = DEFAULT_ATTEMPTS): JobsOptions {
  return { ...defaultJobOptions(attempts), removeOnComplete: { age: DAY_RECALCULATION_KEEP_COMPLETED_SECONDS } };
}
