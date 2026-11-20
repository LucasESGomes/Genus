import type { PunchQueueEntry, QueuePublisher } from '@genus/shared';

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
}
