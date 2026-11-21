import type { PunchJobQueueState, PunchQueueEntry, QueuePublisher } from '@genus/shared';

/** QueuePublisher de teste: grava as chamadas e deixa falhar sob demanda. */
export class FakeQueuePublisher implements QueuePublisher {
  readonly published: PunchQueueEntry[] = [];
  /** Se definido, `publishPunch` lança este erro. */
  publishError: Error | null = null;
  pingResult = true;

  async publishPunch(entry: PunchQueueEntry): Promise<void> {
    if (this.publishError) throw this.publishError;
    this.published.push(entry);
  }

  async ping(): Promise<boolean> {
    return this.pingResult;
  }

  /** Estado devolvido por `getPunchJob`, por jobId. Sem entrada: `null` (job fora do Valkey). */
  readonly jobs = new Map<string, { state: PunchJobQueueState; attemptsMade: number }>();
  /** Se definido, `getPunchJob` lança este erro (Valkey fora). */
  getJobError: Error | null = null;

  async getPunchJob(jobId: string) {
    if (this.getJobError) throw this.getJobError;
    return this.jobs.get(jobId) ?? null;
  }
}
