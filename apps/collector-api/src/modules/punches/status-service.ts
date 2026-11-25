/**
 * Consulta de status das batidas. Só leitura: nada aqui altera uma marcação.
 * O banco é a fonte da verdade (`entradas.status` e o NSR em `evidencias`);
 * o estado do job no BullMQ entra só como diagnóstico, e a falha do Valkey
 * nunca derruba a consulta.
 */
import { parsePunchJobId, punchJobId } from '@genus/queue';
import type {
  DeviceContext,
  Logger,
  PunchListQuery,
  PunchStatusDetailDto,
  PunchStatusDto,
  QueuePublisher,
} from '@genus/shared';
import type { EntryStatus, PunchRepository } from './repository';

export interface PunchStatusServiceDeps {
  repository: PunchRepository;
  queuePublisher: QueuePublisher;
  logger: Logger;
}

function toDto(entry: EntryStatus): PunchStatusDto {
  return {
    jobId: punchJobId(entry.deviceId, entry.deviceSequence),
    receiptId: entry.publicId,
    employeeId: entry.employeeId,
    establishmentId: entry.establishmentId,
    deviceSequence: entry.deviceSequence,
    status: entry.status,
    attempts: entry.attempts,
    nsr: entry.nsr,
    markedAt: entry.markedAt.toISOString(),
    receivedAt: entry.receivedAt.toISOString(),
    processedAt: entry.processedAt ? entry.processedAt.toISOString() : null,
    warnings: entry.isClockDivergent ? ['clock_divergence'] : [],
  };
}

export class PunchStatusService {
  constructor(private readonly deps: PunchStatusServiceDeps) {}

  /** `null` se o jobId for inválido ou não existir batida dele nesta conta. */
  async getByJobId(
    ctx: DeviceContext,
    jobId: string,
    opts: { onlyOwnDevice?: boolean } = {},
  ): Promise<PunchStatusDetailDto | null> {
    const key = parsePunchJobId(jobId);
    if (!key) return null;
    // Totem: a chave do aparelho só enxerga as batidas dele (mesma resposta de "não existe").
    if (opts.onlyOwnDevice && key.deviceId !== ctx.deviceId) return null;
    const entry = await this.deps.repository.findStatusByDeviceSequence(ctx.tenantId, key.deviceId, key.deviceSequence);
    if (!entry) return null;
    return { ...toDto(entry), queue: await this.queueState(jobId) };
  }

  async listByEmployee(
    ctx: DeviceContext,
    query: PunchListQuery,
  ): Promise<{ items: PunchStatusDto[]; total: number }> {
    const { items, total } = await this.deps.repository.listStatusByEmployee(ctx.tenantId, query.employeeId, {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
    return { items: items.map(toDto), total };
  }

  private async queueState(jobId: string): Promise<PunchStatusDetailDto['queue']> {
    try {
      const job = await this.deps.queuePublisher.getPunchJob(jobId);
      return job ? { state: job.state, attemptsMade: job.attemptsMade } : { state: 'not_found', attemptsMade: null };
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      this.deps.logger.warn(
        {
          event: 'queue_state_failed',
          jobId,
          err: { name: err instanceof Error ? err.name : 'unknown', code: typeof code === 'string' ? code : null },
        },
        'fila: não foi possível consultar o job; seguindo só com o banco',
      );
      return { state: 'unavailable', attemptsMade: null };
    }
  }
}
