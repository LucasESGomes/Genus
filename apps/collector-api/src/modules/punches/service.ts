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
} from '@genus/shared';
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
}

const clamp01 = (value: number | null): number | null =>
  value === null || Number.isNaN(value) ? null : Math.min(1, Math.max(0, value));

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
      if (existing) return finish(this.receiptResult(existing), { receiptId: existing.publicId, replayed: true });

      const candidatesTimer = startTimer();
      const set = await candidates.getCandidates(ctx);
      timings.candidates = roundMs(candidatesTimer());
      candidateCount = set.candidates.length;

      const recognized = await engine.recognize({
        tenantId: String(ctx.tenantId),
        image: input.image,
        imageMime: input.imageMime,
        candidates: set.candidates,
        tenantDek: set.tenantDek,
        traceId: publicId,
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
        return finish(this.receiptResult(winner), { receiptId: winner.publicId, replayed: true });
      }
      // FILA: publicar aqui, depois do commit e fora da transação (a planejar)
      timings.dbInsert = roundMs(dbTimer());

      return finish(
        {
          receiptId: inserted.publicId,
          outcome: 'registered',
          markedAt: inserted.markedAt.toISOString(),
          warnings,
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

  private receiptResult(receipt: {
    publicId: string;
    markedAt: Date;
    isClockDivergent: boolean;
  }): PunchResultDto {
    return {
      receiptId: receipt.publicId,
      outcome: 'registered',
      markedAt: receipt.markedAt.toISOString(),
      warnings: receipt.isClockDivergent ? ['clock_divergence'] : [],
    };
  }

  private fallbackResult(reason: FallbackReason): PunchResultDto {
    return { outcome: 'fallback_required', reason, warnings: [] };
  }
}
