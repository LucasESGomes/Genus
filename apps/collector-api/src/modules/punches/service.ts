/**
 * Regra da batida. Nunca bloqueia: rosto não identificado ou engine fora viram
 * `fallback_required`; duplicidade e hora divergente só sinalizam.
 */
import { randomUUID } from 'node:crypto';
import {
  DUPLICATE_WINDOW_MS,
  roundMs,
  startTimer,
  type CandidateProvider,
  type Clock,
  type DeviceContext,
  type EngineClient,
  type FallbackReason,
  type Logger,
  type PunchResultDto,
  type PunchTimings,
  type PunchWarning,
  type QueuePublisher,
} from '@genus/shared';
import { punchJobId } from '@genus/queue';
import type { PunchRepository } from './repository';
import { resolveMarkedAt } from './rules/clock-divergence';

export interface PunchInput {
  image: Buffer;
  imageMime: string;
  deviceSequence: number;
  capturedAt: Date;
  /** Tempo já gasto validando a requisição. */
  validateMs: number;
  /** Cronômetro iniciado quando a requisição chegou (para o `total`). */
  totalTimer: () => number;
}

export interface PunchOutput {
  result: PunchResultDto;
  timings: PunchTimings;
}

export interface PunchServiceDeps {
  repository: PunchRepository;
  candidates: CandidateProvider;
  engine: EngineClient;
  clock: Clock;
  logger: Logger;
  /** Publica em `punches` depois do commit. Falha nunca muda a resposta. */
  queuePublisher: QueuePublisher;
}

const clamp01 = (value: number | null): number | null =>
  value === null || Number.isNaN(value) ? null : Math.min(1, Math.max(0, value));

/** Só o primeiro nome sai na resposta (tela do aparelho); nunca CPF nem nome completo. */
const firstName = (displayName: string) => displayName.trim().split(/\s+/)[0] ?? '';

export class PunchService {
  constructor(private readonly deps: PunchServiceDeps) {}

  async register(ctx: DeviceContext, input: PunchInput): Promise<PunchOutput> {
    const { repository, candidates, engine, clock, logger } = this.deps;
    const publicId = randomUUID();
    const timings: PunchTimings = {
      validate: roundMs(input.validateMs),
      candidates: null,
      engineRoundTrip: null,
      engineProcessing: null,
      engineStages: null,
      dbInsert: null,
      total: 0,
    };
    let candidateCount = 0;
    // Determinístico: o mesmo que o publicador e o resgate usam.
    const jobId = punchJobId(ctx.deviceId, input.deviceSequence);

    const finish = (
      result: PunchResultDto,
      extra: { receiptId: string | null; replayed: boolean },
    ): PunchOutput => {
      timings.total = roundMs(input.totalTimer());
      logger.info(
        {
          receiptId: extra.receiptId,
          traceId: publicId,
          outcome: result.outcome,
          reason: result.outcome === 'fallback_required' ? result.reason : null,
          candidateCount,
          replayed: extra.replayed,
          warnings: result.warnings,
          timingsMs: timings,
        },
        'punch_recognition',
      );
      return { result, timings };
    };

    try {
      // Idempotência: o aparelho reenvia até receber o recibo.
      const existing = await repository.findByDeviceSequence(ctx.tenantId, ctx.deviceId, input.deviceSequence);
      if (existing) return finish(this.receiptResult(existing, jobId), { receiptId: existing.publicId, replayed: true });

      const candidatesTimer = startTimer();
      const set = await candidates.getCandidates(ctx);
      timings.candidates = roundMs(candidatesTimer());
      candidateCount = set.candidates.length;

      // Ninguém com rosto cadastrado neste estabelecimento: não há o que comparar. Não bloqueia (Portaria 671).
      if (candidateCount === 0) {
        return finish(this.fallbackResult('not_recognized'), { receiptId: null, replayed: false });
      }

      const recognized = await engine.recognize({
        tenantId: String(ctx.tenantId),
        image: input.image,
        imageMime: input.imageMime,
        candidates: set.candidates,
        tenantDek: set.tenantDek,
        traceId: publicId,
        recognitionThreshold: ctx.recognitionThreshold ?? null,
        livenessThreshold: ctx.livenessThreshold ?? null,
      });
      timings.engineRoundTrip = recognized.timing.roundTripMs;
      timings.engineProcessing = recognized.timing.processingMs;
      timings.engineStages = recognized.timing.stages;

      if (recognized.kind === 'fallback') {
        return finish(this.fallbackResult(recognized.reason), { receiptId: null, replayed: false });
      }

      const person = set.candidates.find((c) => c.employeeId === recognized.employeeId);
      if (!person) throw new Error('Pessoa identificada fora da lista de candidatos');

      const { markedAt, isClockDivergent } = resolveMarkedAt(input.capturedAt, clock.now());
      const warnings: PunchWarning[] = [];
      if (isClockDivergent) warnings.push('clock_divergence');

      const dbTimer = startTimer();
      // A checagem só serve para avisar: se falhar, segue sem o aviso e grava.
      const isDuplicate = await repository
        .existsByCpfBetween(
          ctx.tenantId,
          person.cpf,
          new Date(markedAt.getTime() - DUPLICATE_WINDOW_MS),
          new Date(markedAt.getTime() + DUPLICATE_WINDOW_MS),
        )
        .catch((err: unknown) => {
          logger.warn({ traceId: publicId, err: err instanceof Error ? err.name : 'unknown' }, 'duplicidade: checagem falhou; seguindo sem o aviso');
          return false;
        });
      // Duplicidade só sinaliza: a batida é registrada do mesmo jeito.
      if (isDuplicate) warnings.push('possible_duplicate');

      const inserted = await repository.insertIfAbsent(ctx.tenantId, {
        publicId,
        establishmentId: ctx.establishmentId,
        deviceId: ctx.deviceId,
        deviceSequence: input.deviceSequence,
        employeeId: person.employeeId,
        cpf: person.cpf,
        markedAt,
        receivedAt: clock.now(),
        isClockDivergent,
        recognitionScore: clamp01(recognized.recognitionScore),
        livenessScore: clamp01(recognized.livenessScore),
      });
      if (!inserted) {
        // Corrida: outra requisição gravou a mesma (aparelho, sequência) entre o SELECT e o INSERT.
        const winner = await repository.findByDeviceSequence(ctx.tenantId, ctx.deviceId, input.deviceSequence);
        if (!winner) throw new Error('Entrada não encontrada após conflito de idempotência');
        timings.dbInsert = roundMs(dbTimer());
        // Quem perdeu a corrida também tenta publicar: o vencedor pode ter caído antes de publicar.
        // O jobId é determinístico, então publicar duas vezes é no-op.
        await this.publishPunch(ctx, input.deviceSequence, winner.id, publicId);
        return finish(this.receiptResult(winner, jobId, firstName(person.displayName)), { receiptId: winner.publicId, replayed: true });
      }
      timings.dbInsert = roundMs(dbTimer());
      // Só agora, com o INSERT já confirmado (commit automático do statement) e fora de transação.
      await this.publishPunch(ctx, input.deviceSequence, inserted.id, publicId);

      return finish(
        {
          receiptId: inserted.publicId,
          jobId,
          outcome: 'registered',
          markedAt: inserted.markedAt.toISOString(),
          warnings,
          employeeFirstName: firstName(person.displayName),
        },
        { receiptId: inserted.publicId, replayed: false },
      );
    } catch (err) {
      timings.total = roundMs(input.totalTimer());
      logger.info(
        {
          receiptId: null,
          traceId: publicId,
          outcome: 'error',
          reason: null,
          candidateCount,
          replayed: false,
          warnings: [],
          timingsMs: timings,
        },
        'punch_recognition',
      );
      throw err;
    }
  }

  /**
   * Publica a batida em `punches`. Tolerante a falha por regra da Portaria 671:
   * a marcação já está gravada e nunca é bloqueada. O resgate (apps/jobs)
   * enfileira o que ficou de fora. O log leva só nome/código do erro: a
   * mensagem de conexão pode citar host.
   */
  private async publishPunch(
    ctx: DeviceContext,
    deviceSequence: number,
    entryId: number,
    traceId: string,
  ): Promise<void> {
    try {
      await this.deps.queuePublisher.publishPunch({
        entryId,
        tenantId: ctx.tenantId,
        establishmentId: ctx.establishmentId,
        deviceId: ctx.deviceId,
        deviceSequence,
      });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      this.deps.logger.warn(
        {
          event: 'queue_publish_failed',
          traceId,
          entryId,
          err: { name: err instanceof Error ? err.name : 'unknown', code: typeof code === 'string' ? code : null },
        },
        'fila: falha ao publicar a batida; o resgate cobre',
      );
    }
  }

  private receiptResult(
    receipt: { publicId: string; markedAt: Date; isClockDivergent: boolean },
    jobId: string,
    employeeFirstName?: string,
  ): PunchResultDto {
    return {
      receiptId: receipt.publicId,
      jobId,
      outcome: 'registered',
      markedAt: receipt.markedAt.toISOString(),
      warnings: receipt.isClockDivergent ? ['clock_divergence'] : [],
      ...(employeeFirstName ? { employeeFirstName } : {}),
    };
  }

  private fallbackResult(reason: FallbackReason): PunchResultDto {
    return { outcome: 'fallback_required', reason, warnings: [] };
  }
}
