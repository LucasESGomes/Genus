/**
 * Inspeção SÓ LEITURA das filas `punches` e `post-punch` no Valkey (BullMQ), para o painel do
 * super_admin. Reutiliza as conexões e os nomes de `@genus/queue`.
 *
 * A conexão é a de publicação do pacote (sem fila offline, timeouts curtos): com o Valkey fora,
 * cada comando falha na hora e a api segue de pé. Erros de conexão são logados uma vez por queda,
 * só com `err.name` (a mensagem do ioredis pode citar host e porta).
 */
import { createPostPunchQueue, createProducerConnection, createPunchesQueue, POST_PUNCH_QUEUE, PUNCHES_QUEUE } from '@genus/queue';
import type { Clock, Logger } from '@genus/shared';
import type { QueueCounts, QueueInspector } from '../deps';

export interface ValkeyQueueInspectorOptions {
  /** `redis://host:porta` SEM senha. */
  url: string;
  password?: string | undefined;
  /** Prazo de cada comando. Padrão 1000 ms. */
  timeoutMs?: number;
  clock: Clock;
  logger: Logger;
}

type Connection = ReturnType<typeof createProducerConnection>;
/** O mínimo de uma Queue do BullMQ que a inspeção usa (as duas filas têm payloads diferentes). */
interface InspectedQueue {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  getJobs(types: string[], start: number, end: number, asc: boolean): Promise<{ timestamp: number }[]>;
  close(): Promise<void>;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

export class ValkeyQueueInspector implements QueueInspector {
  private readonly connection: Connection;
  private readonly queues: Record<'punches' | 'post-punch', InspectedQueue>;
  private errorLogged = false;

  constructor(private readonly o: ValkeyQueueInspectorOptions) {
    this.connection = createProducerConnection({ url: o.url, password: o.password, publishTimeoutMs: o.timeoutMs ?? 1000 });
    this.connection.on('error', (err: Error) => {
      if (this.errorLogged) return;
      this.errorLogged = true;
      o.logger.warn({ err: { name: err.name } }, 'valkey: conexão do painel do super_admin com erro');
    });
    this.connection.on('ready', () => {
      this.errorLogged = false;
    });
    // As Queue herdam `enableOfflineQueue: false` da conexão. Erros próprias delas vão para o mesmo log.
    const punches = createPunchesQueue(this.connection);
    const postPunch = createPostPunchQueue(this.connection);
    for (const q of [punches, postPunch]) q.on('error', () => undefined);
    this.queues = { [PUNCHES_QUEUE]: punches, [POST_PUNCH_QUEUE]: postPunch } as unknown as Record<'punches' | 'post-punch', InspectedQueue>;
  }

  async ping(): Promise<void> {
    const reply = await this.connection.ping();
    if (reply !== 'PONG') throw new Error('ping');
  }

  async counts(queue: 'punches' | 'post-punch'): Promise<QueueCounts> {
    const q = this.queues[queue];
    const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'failed');
    let oldestWaitingAgeSeconds: number | null = null;
    if ((counts.waiting ?? 0) > 0) {
      // asc = true: o mais antigo primeiro (a lista `wait` é LPUSH; o BullMQ inverte o intervalo).
      const [oldest] = await q.getJobs(['waiting'], 0, 0, true);
      if (oldest) oldestWaitingAgeSeconds = Math.max(0, Math.round((this.o.clock.now().getTime() - oldest.timestamp) / 1000));
    }
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      oldestWaitingAgeSeconds,
    };
  }

  async close(): Promise<void> {
    await Promise.allSettled(Object.values(this.queues).map((q) => q.close()));
    this.connection.disconnect();
  }
}
