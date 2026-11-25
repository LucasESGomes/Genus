/**
 * Reconhecimento facial entre contas: SÓ agregados de `arp.entradas` (04 §1.4). `notRecognized`,
 * `livenessFailed`, `latencyP50Ms` e `latencyP95Ms` são sempre null: o arp não guarda tentativas
 * falhas nem latência (dependem do coletor).
 *
 * Cache em memória de 60 s por consulta (as agregações varrem a janela inteira). A leitura é auditada
 * a CADA requisição (uma linha `leitura_sensivel` de `recognition_stats`), mesmo quando vem do cache.
 */
import type { Clock } from '@genus/shared';
import { inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { devices } from '../../../db/schema';
import type { RequestContext } from '../../../plugins/request-context';
import { recordAudit } from '../../audit/audit';
import { auditTenantId } from '../audit-tenant';
import type { recognitionDevicesResponse, recognitionQuery, recognitionSeriesQuery, recognitionSeriesResponse, recognitionSummaryDto, StatsWindow } from '../contract';
import type { ArpScope, SuperAdminDeps } from '../deps';

type Query = z.infer<typeof recognitionQuery>;
type SeriesQuery = z.infer<typeof recognitionSeriesQuery>;
type SummaryDto = z.infer<typeof recognitionSummaryDto>;
type SeriesDto = z.infer<typeof recognitionSeriesResponse>['data'];
type DevicesDto = z.infer<typeof recognitionDevicesResponse>['data'];

export const RECOGNITION_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 200;
const WINDOW_MS: Record<StatsWindow, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/** Notas com 4 casas decimais. */
const round4 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10_000) / 10_000);

export class RecognitionService {
  private readonly cache = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly clock: Clock;

  constructor(private readonly d: Pick<SuperAdminDeps, 'db' | 'clock' | 'recognition'>) {
    this.clock = d.clock;
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value as T;
    const value = await load();
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      for (const [k, v] of this.cache) if (v.expiresAt <= now) this.cache.delete(k);
      if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    }
    this.cache.set(key, { expiresAt: now + RECOGNITION_CACHE_TTL_MS, value });
    return value;
  }

  private scope(q: Query): ArpScope {
    const to = this.clock.now();
    return { tenantId: q.tenantId ?? null, establishmentId: q.establishmentId, deviceId: q.deviceId, from: new Date(to.getTime() - WINDOW_MS[q.window]), to };
  }

  private async audit(ctx: RequestContext, view: string, q: Query, extra: Record<string, unknown> = {}): Promise<void> {
    return recordAudit(this.d.db, this.clock, {
      tenantId: await auditTenantId(this.d.db, q.tenantId),
      userId: ctx.userId,
      entity: 'recognition_stats',
      entityId: q.tenantId ?? 0,
      action: 'leitura_sensivel',
      after: { view, window: q.window, tenantId: q.tenantId, establishmentId: q.establishmentId, deviceId: q.deviceId, ...extra },
    });
  }

  async summary(ctx: RequestContext, q: Query): Promise<SummaryDto> {
    const value = await this.cached(`summary:${JSON.stringify(q)}`, async (): Promise<SummaryDto> => {
      const scope = this.scope(q);
      const r = await this.d.recognition.summary(scope);
      return {
        window: q.window,
        from: scope.from.toISOString(),
        to: scope.to.toISOString(),
        punches: r.punches,
        byStatus: { pendente: r.pendente, processado: r.processado, falhou: r.falhou },
        divergentClock: r.divergentClock,
        recognitionScore: { avg: round4(r.recognitionAvg), p50: round4(r.recognitionP50), p05: round4(r.recognitionP05) },
        livenessScore: { avg: round4(r.livenessAvg), p50: round4(r.livenessP50), p05: round4(r.livenessP05) },
        livenessHistogram: r.livenessHistogram,
        notRecognized: null,
        livenessFailed: null,
        latencyP50Ms: null,
        latencyP95Ms: null,
      };
    });
    await this.audit(ctx, 'summary', q);
    return value;
  }

  async series(ctx: RequestContext, q: SeriesQuery): Promise<SeriesDto> {
    const value = await this.cached(`series:${JSON.stringify(q)}`, async (): Promise<SeriesDto> => {
      const rows = await this.d.recognition.series(this.scope(q), q.bucket);
      return rows.map((r) => ({
        bucketStart: r.bucketStart.toISOString(),
        punches: r.punches,
        failed: r.failed,
        avgRecognitionScore: round4(r.avgRecognitionScore),
        avgLivenessScore: round4(r.avgLivenessScore),
      }));
    });
    await this.audit(ctx, 'series', q, { bucket: q.bucket });
    return value;
  }

  async devices(ctx: RequestContext, q: Query): Promise<DevicesDto> {
    const value = await this.cached(`devices:${JSON.stringify(q)}`, async (): Promise<DevicesDto> => {
      const rows = await this.d.recognition.devices(this.scope(q));
      const ids = [...new Set(rows.map((r) => r.deviceId))];
      const names = new Map<number, string>();
      if (ids.length > 0) {
        for (const d of await this.d.db.select({ id: devices.id, name: devices.name }).from(devices).where(inArray(devices.id, ids))) names.set(d.id, d.name);
      }
      return rows.map((r) => ({
        tenantId: r.tenantId,
        establishmentId: r.establishmentId,
        deviceId: r.deviceId,
        deviceName: names.get(r.deviceId) ?? null,
        punches: r.punches,
        failed: r.failed,
        divergentClock: r.divergentClock,
        avgRecognitionScore: round4(r.avgRecognitionScore),
        avgLivenessScore: round4(r.avgLivenessScore),
        lastPunchAt: r.lastPunchAt?.toISOString() ?? null,
      }));
    });
    await this.audit(ctx, 'devices', q);
    return value;
  }
}
