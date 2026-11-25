/**
 * Aparelhos (totem web) e a calibração deles, docs/totem-contrato.md §3.1.
 * Perfis: rh e admin; estabelecimento fora do escopo = 404. A chave em claro só sai na resposta de
 * criar/regenerar; banco, log e auditoria guardam no máximo o prefixo (e nem ele na auditoria).
 */
import type { Clock } from '@genus/shared';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import type { Executor } from '../../db/executor';
import { biometricConsents, calibrationSessions, devices, deviceEvents, establishments } from '../../db/schema';
import { establishmentInScope, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit, type AuditAction } from '../audit/audit';
import { generateDeviceKey } from './key';
import type {
  CalibrationSessionDto,
  CalibrationSettingsDto,
  copyCalibrationBody,
  createDeviceBody,
  DeviceDto,
  listDevicesQuery,
  thresholdsBody,
  updateDeviceBody,
} from './schemas';

type DeviceRow = typeof devices.$inferSelect;
type SessionRow = typeof calibrationSessions.$inferSelect;
type EventType = (typeof deviceEvents.$inferInsert)['type'];

/** Online = conexão nos últimos 2 minutos (docs/totem-contrato.md §3.1). */
export const ONLINE_WINDOW_MS = 2 * 60_000;
/** [A CONFIRMAR] calibração com mais de 180 dias vira `desatualizado` (o contrato não define o prazo). */
export const CALIBRATION_STALE_DAYS = 180;
const ACTIVITY_LIMIT = 50;

export interface DeviceServiceDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
  engineDefaults: { recognitionThreshold: number; livenessThreshold: number };
}

export function toSessionDto(row: SessionRow): CalibrationSessionDto {
  const result = row.result as Record<string, unknown> | null;
  const failed = row.status === 'falhou';
  return {
    id: row.id,
    status: row.status as CalibrationSessionDto['status'],
    startedAt: row.startedAt.toISOString(),
    computedAt: row.computedAt?.toISOString() ?? null,
    result: !failed && result ? (result as unknown as CalibrationSessionDto['result']) : null,
    failureReason: failed && typeof result?.failureReason === 'string' ? result.failureReason : null,
  };
}

export class DeviceService {
  constructor(private readonly d: DeviceServiceDeps) {}

  // ---- leitura -----------------------------------------------------------------------------

  private async load(ex: Executor, ctx: RequestContext, id: number, lock = false): Promise<DeviceRow> {
    const query = ex
      .select()
      .from(devices)
      .where(and(eq(devices.tenantId, tenantOf(ctx)), eq(devices.id, id)))
      .limit(1);
    const [row] = lock ? await query.for('update') : await query;
    if (!row || !establishmentInScope(ctx, row.establishmentId)) throw notFound('Aparelho');
    return row;
  }

  private toDto(row: DeviceRow, hasPunches: boolean): DeviceDto {
    const now = this.d.clock.now().getTime();
    const connection = !row.isActive ? 'inativo' : row.lastConnectionAt && now - row.lastConnectionAt.getTime() <= ONLINE_WINDOW_MS ? 'online' : 'offline';
    const hasThresholds = row.recognitionThreshold !== null || row.livenessThreshold !== null;
    const stale = row.calibratedAt !== null && now - row.calibratedAt.getTime() > CALIBRATION_STALE_DAYS * 86_400_000;
    return {
      id: row.id,
      establishmentId: row.establishmentId,
      name: row.name,
      isActive: row.isActive,
      connection,
      lastSyncAt: row.lastConnectionAt?.toISOString() ?? null,
      // o totem web envia na hora: nunca há batida guardada no aparelho
      pendingPunches: 0,
      appVersion: row.appVersion,
      calibrationState: !hasThresholds ? 'padrao' : stale ? 'desatualizado' : 'calibrado',
      hasPunches,
      keyPrefix: row.keyPrefix,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async dtos(tenantId: number, rows: DeviceRow[]): Promise<DeviceDto[]> {
    const withPunches = await this.d.arp.devicesWithPunches(
      tenantId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toDto(r, withPunches.has(r.id)));
  }

  private async dto(ctx: RequestContext, row: DeviceRow): Promise<DeviceDto> {
    return (await this.dtos(tenantOf(ctx), [row]))[0]!;
  }

  async list(ctx: RequestContext, q: z.infer<typeof listDevicesQuery>): Promise<DeviceDto[]> {
    const tenantId = tenantOf(ctx);
    const rows = await this.d.db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.tenantId, tenantId),
          q.establishmentId ? eq(devices.establishmentId, q.establishmentId) : undefined,
          ctx.establishmentScope ? inArray(devices.establishmentId, ctx.establishmentScope) : undefined,
        ),
      )
      .orderBy(devices.name, devices.id);
    const list = await this.dtos(tenantId, rows);
    return q.connection ? list.filter((x) => x.connection === q.connection) : list;
  }

  async get(ctx: RequestContext, id: number): Promise<DeviceDto> {
    return this.dto(ctx, await this.load(this.d.db, ctx, id));
  }

  async activity(ctx: RequestContext, id: number) {
    await this.load(this.d.db, ctx, id);
    const rows = await this.d.db
      .select()
      .from(deviceEvents)
      .where(and(eq(deviceEvents.tenantId, tenantOf(ctx)), eq(deviceEvents.deviceId, id)))
      .orderBy(desc(deviceEvents.id))
      .limit(ACTIVITY_LIMIT);
    return rows.map((r) => ({ id: r.id, type: r.type, description: r.description, createdAt: r.createdAt.toISOString() }));
  }

  // ---- cadastro ----------------------------------------------------------------------------

  private async event(ex: Executor, tenantId: number, deviceId: number, type: EventType, description: string) {
    await ex.insert(deviceEvents).values({ tenantId, deviceId, type, description, createdAt: this.d.clock.now() });
  }

  private audit(
    ex: Executor,
    ctx: RequestContext,
    deviceId: number,
    action: AuditAction,
    event: string,
    data: { before?: Record<string, unknown>; after?: Record<string, unknown> } = {},
  ) {
    return recordAudit(ex, this.d.clock, {
      tenantId: tenantOf(ctx),
      userId: ctx.userId,
      entity: 'aparelhos',
      entityId: deviceId,
      action,
      before: data.before ?? null,
      after: { event, ...data.after },
    });
  }

  async create(ctx: RequestContext, body: z.infer<typeof createDeviceBody>): Promise<{ device: DeviceDto; apiKey: string }> {
    const tenantId = tenantOf(ctx);
    if (!establishmentInScope(ctx, body.establishmentId)) throw notFound('Estabelecimento');
    const [est] = await this.d.db
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, body.establishmentId)))
      .limit(1);
    if (!est) throw notFound('Estabelecimento');

    const key = generateDeviceKey();
    const now = this.d.clock.now();
    const row = await this.d.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(devices)
        .values({ tenantId, establishmentId: body.establishmentId, name: body.name, keyHash: key.hash, keyPrefix: key.prefix, keyGeneratedAt: now, createdAt: now })
        .returning();
      await this.event(tx, tenantId, created!.id, 'ativado', 'Aparelho criado');
      await this.audit(tx, ctx, created!.id, 'criacao', 'device.created', { after: { establishmentId: body.establishmentId, name: body.name } });
      return created!;
    });
    return { device: this.toDto(row, false), apiKey: key.key };
  }

  async update(ctx: RequestContext, id: number, body: z.infer<typeof updateDeviceBody>): Promise<DeviceDto> {
    const row = await this.d.db.transaction(async (tx) => {
      const current = await this.load(tx, ctx, id, true);
      const set: Partial<typeof devices.$inferInsert> = {};
      if (body.name !== undefined) set.name = body.name;
      if (body.isActive !== undefined) set.isActive = body.isActive;
      const [updated] = await tx
        .update(devices)
        .set(set)
        .where(and(eq(devices.tenantId, current.tenantId), eq(devices.id, id)))
        .returning();
      if (body.isActive !== undefined && body.isActive !== current.isActive) {
        await this.event(tx, current.tenantId, id, body.isActive ? 'ativado' : 'desativado', body.isActive ? 'Aparelho ativado' : 'Aparelho desativado');
      }
      await this.audit(tx, ctx, id, 'alteracao', 'device.updated', {
        before: { name: current.name, isActive: current.isActive },
        after: { name: updated!.name, isActive: updated!.isActive },
      });
      return updated!;
    });
    return this.dto(ctx, row);
  }

  async regenerateKey(ctx: RequestContext, id: number): Promise<{ device: DeviceDto; apiKey: string }> {
    const key = generateDeviceKey();
    const now = this.d.clock.now();
    const row = await this.d.db.transaction(async (tx) => {
      const current = await this.load(tx, ctx, id, true);
      const [updated] = await tx
        .update(devices)
        .set({ keyHash: key.hash, keyPrefix: key.prefix, keyGeneratedAt: now })
        .where(and(eq(devices.tenantId, current.tenantId), eq(devices.id, id)))
        .returning();
      await this.event(tx, current.tenantId, id, 'chave_regenerada', 'Chave do aparelho regenerada');
      // sem a chave nem o hash: só o fato
      await this.audit(tx, ctx, id, 'alteracao', 'device.key_regenerated');
      return updated!;
    });
    return { device: await this.dto(ctx, row), apiKey: key.key };
  }

  async remove(ctx: RequestContext, id: number): Promise<void> {
    const tenantId = tenantOf(ctx);
    const current = await this.load(this.d.db, ctx, id);
    // O arp é outro banco: a leitura vem antes da transação. Aparelho com batida (até pendente) fica, só desativa.
    if ((await this.d.arp.devicesWithPunches(tenantId, [id])).has(id)) {
      throw new HttpError(409, 'APARELHO_COM_BATIDAS', 'Este aparelho já registrou batidas e não pode ser excluído. Desative-o');
    }
    await this.d.db.transaction(async (tx) => {
      // referências que não são do aparelho: o termo de consentimento fica, sem o vínculo; a calibração copiada fica, sem a origem
      await tx
        .update(biometricConsents)
        .set({ deviceId: null })
        .where(and(eq(biometricConsents.tenantId, tenantId), eq(biometricConsents.deviceId, id)));
      await tx
        .update(devices)
        .set({ calibrationSourceId: null })
        .where(and(eq(devices.tenantId, tenantId), eq(devices.calibrationSourceId, id)));
      // sessões e eventos do aparelho saem em cascata
      await tx.delete(devices).where(and(eq(devices.tenantId, tenantId), eq(devices.id, id)));
      await this.audit(tx, ctx, id, 'exclusao', 'device.deleted', { before: { establishmentId: current.establishmentId, name: current.name } });
    });
  }

  // ---- calibração --------------------------------------------------------------------------

  private async settings(ex: Executor, row: DeviceRow): Promise<CalibrationSettingsDto> {
    let sourceName: string | null = null;
    if (row.calibrationSourceId !== null) {
      const [src] = await ex
        .select({ name: devices.name })
        .from(devices)
        .where(and(eq(devices.tenantId, row.tenantId), eq(devices.id, row.calibrationSourceId)));
      sourceName = src?.name ?? null;
    }
    return {
      recognitionThreshold: row.recognitionThreshold,
      livenessThreshold: row.livenessThreshold,
      effectiveRecognitionThreshold: row.recognitionThreshold ?? this.d.engineDefaults.recognitionThreshold,
      effectiveLivenessThreshold: row.livenessThreshold ?? this.d.engineDefaults.livenessThreshold,
      isCalibrated: row.recognitionThreshold !== null || row.livenessThreshold !== null,
      calibratedAt: row.calibratedAt?.toISOString() ?? null,
      calibrationSourceDeviceId: row.calibrationSourceId,
      calibrationSourceName: sourceName,
    };
  }

  async getSettings(ctx: RequestContext, id: number): Promise<CalibrationSettingsDto> {
    return this.settings(this.d.db, await this.load(this.d.db, ctx, id));
  }

  /** A sessão que o painel acompanha: a mais recente que ainda não foi decidida (ou que falhou). */
  async getSession(ctx: RequestContext, id: number): Promise<CalibrationSessionDto | null> {
    await this.load(this.d.db, ctx, id);
    const [row] = await this.d.db
      .select()
      .from(calibrationSessions)
      .where(
        and(
          eq(calibrationSessions.tenantId, tenantOf(ctx)),
          eq(calibrationSessions.deviceId, id),
          inArray(calibrationSessions.status, ['aguardando', 'calculada', 'falhou']),
        ),
      )
      .orderBy(desc(calibrationSessions.id))
      .limit(1);
    return row ? toSessionDto(row) : null;
  }

  private lockSession(ex: Executor, tenantId: number, deviceId: number, statuses: string[] = ['aguardando', 'calculada']) {
    return ex
      .select()
      .from(calibrationSessions)
      .where(and(eq(calibrationSessions.tenantId, tenantId), eq(calibrationSessions.deviceId, deviceId), inArray(calibrationSessions.status, statuses)))
      .orderBy(desc(calibrationSessions.id))
      .limit(1)
      .for('update');
  }

  async startCalibration(ctx: RequestContext, id: number): Promise<CalibrationSessionDto> {
    const row = await this.d.db.transaction(async (tx) => {
      const device = await this.load(tx, ctx, id, true);
      if (!device.isActive) throw new HttpError(409, 'APARELHO_INATIVO', 'Ative o aparelho antes de calibrar');
      const [open] = await this.lockSession(tx, device.tenantId, id);
      if (open) throw new HttpError(409, 'CALIBRACAO_EM_ANDAMENTO', 'Já existe uma calibração em andamento neste aparelho');
      const [created] = await tx
        .insert(calibrationSessions)
        .values({ tenantId: device.tenantId, deviceId: id, startedById: ctx.userId, startedAt: this.d.clock.now() })
        .returning();
      await this.event(tx, device.tenantId, id, 'calibracao', 'Calibração iniciada');
      await this.audit(tx, ctx, id, 'alteracao', 'device.calibration_started', { after: { sessionId: created!.id } });
      return created!;
    });
    return toSessionDto(row);
  }

  async discardSession(ctx: RequestContext, id: number): Promise<void> {
    await this.d.db.transaction(async (tx) => {
      const device = await this.load(tx, ctx, id, true);
      const [session] = await this.lockSession(tx, device.tenantId, id, ['aguardando', 'calculada', 'falhou']);
      if (!session) throw notFound('Calibração');
      await tx
        .update(calibrationSessions)
        .set({ status: 'descartada', decidedById: ctx.userId, decidedAt: this.d.clock.now() })
        .where(eq(calibrationSessions.id, session.id));
      await this.event(tx, device.tenantId, id, 'calibracao', 'Calibração descartada');
      await this.audit(tx, ctx, id, 'alteracao', 'device.calibration_discarded', { after: { sessionId: session.id } });
    });
  }

  async applySettings(ctx: RequestContext, id: number, body: z.infer<typeof thresholdsBody>): Promise<CalibrationSettingsDto> {
    return this.d.db.transaction(async (tx) => {
      const device = await this.load(tx, ctx, id, true);
      const now = this.d.clock.now();
      const [updated] = await tx
        .update(devices)
        .set({ recognitionThreshold: body.recognitionThreshold, livenessThreshold: body.livenessThreshold, calibratedAt: now, calibrationSourceId: null })
        .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, id)))
        .returning();
      // a sessão calculada que originou os valores passa a aplicada
      const [session] = await this.lockSession(tx, device.tenantId, id, ['calculada']);
      if (session) {
        await tx.update(calibrationSessions).set({ status: 'aplicada', decidedById: ctx.userId, decidedAt: now }).where(eq(calibrationSessions.id, session.id));
      }
      await this.event(tx, device.tenantId, id, 'calibracao', 'Calibração aplicada');
      await this.audit(tx, ctx, id, 'alteracao', 'device.calibration_applied', {
        before: { recognitionThreshold: device.recognitionThreshold, livenessThreshold: device.livenessThreshold },
        after: { recognitionThreshold: body.recognitionThreshold, livenessThreshold: body.livenessThreshold, sessionId: session?.id ?? null },
      });
      return this.settings(tx, updated!);
    });
  }

  async resetSettings(ctx: RequestContext, id: number): Promise<CalibrationSettingsDto> {
    return this.d.db.transaction(async (tx) => {
      const device = await this.load(tx, ctx, id, true);
      const [updated] = await tx
        .update(devices)
        .set({ recognitionThreshold: null, livenessThreshold: null, calibratedAt: null, calibrationSourceId: null })
        .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, id)))
        .returning();
      await this.event(tx, device.tenantId, id, 'calibracao', 'Calibração restaurada ao padrão');
      await this.audit(tx, ctx, id, 'alteracao', 'device.calibration_reset', {
        before: { recognitionThreshold: device.recognitionThreshold, livenessThreshold: device.livenessThreshold },
      });
      return this.settings(tx, updated!);
    });
  }

  async copyCalibration(ctx: RequestContext, id: number, body: z.infer<typeof copyCalibrationBody>): Promise<CalibrationSettingsDto> {
    if (body.sourceDeviceId === id) throw new HttpError(400, 'VALIDATION_ERROR', 'Escolha outro aparelho como origem');
    return this.d.db.transaction(async (tx) => {
      const device = await this.load(tx, ctx, id, true);
      // origem de outro estabelecimento (ou de outra conta) = 404, como se não existisse
      const [source] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, body.sourceDeviceId), eq(devices.establishmentId, device.establishmentId), ne(devices.id, id)));
      if (!source || !establishmentInScope(ctx, source.establishmentId)) throw notFound('Aparelho de origem');
      if (source.recognitionThreshold === null && source.livenessThreshold === null) {
        throw new HttpError(409, 'CALIBRACAO_SEM_ORIGEM', 'O aparelho de origem não está calibrado');
      }
      const [updated] = await tx
        .update(devices)
        .set({ recognitionThreshold: source.recognitionThreshold, livenessThreshold: source.livenessThreshold, calibratedAt: this.d.clock.now(), calibrationSourceId: source.id })
        .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, id)))
        .returning();
      await this.event(tx, device.tenantId, id, 'calibracao', `Calibração copiada do aparelho ${source.name}`);
      await this.audit(tx, ctx, id, 'alteracao', 'device.calibration_copied', {
        before: { recognitionThreshold: device.recognitionThreshold, livenessThreshold: device.livenessThreshold },
        after: { recognitionThreshold: source.recognitionThreshold, livenessThreshold: source.livenessThreshold, sourceDeviceId: source.id },
      });
      return this.settings(tx, updated!);
    });
  }
}
