/**
 * Totem web (autenticado por `X-Device-Key`), docs/totem-contrato.md §3.2:
 *   - contexto do aparelho (e o aviso de que há calibração à espera);
 *   - cadastro facial (reaproveita `FacialEnrollmentService` com o aparelho como autor);
 *   - envio das fotos da calibração, calculada na engine. As fotos ficam só na memória desta
 *     requisição: nada é gravado em disco, em banco nem em log; o banco recebe só números agregados.
 */
import type { Clock } from '@genus/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database } from '../../db/client';
import { calibrationSessions, deviceEvents, devices, establishments } from '../../db/schema';
import { notFound } from '../../http/access';
import { positiveId } from '../../http/schemas';
import { HttpError } from '../../plugins/error-handler';
import type { DeviceContext } from '../../plugins/device-auth';
import { recordAudit } from '../audit/audit';
import { buildCalibrationResult, personOfCalibrationFile } from '../devices/rules/calibration-result';
import { EngineRejectedError, EngineUnavailableError, type CalibrationImage, type FacialEngineClient } from '../facial/engine-client';
import type { EnrollmentActor, FacialEnrollmentService } from '../facial/enrollment';

/** Uma conexão registrada no histórico a cada 10 minutos, no máximo. */
export const CONNECTION_EVENT_INTERVAL_MS = 10 * 60_000;

const IMAGE_TYPES = [
  { mime: 'image/jpeg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
] as const;

/** Limites que a engine exige (POST /calibrate/recognition e /calibrate/liveness). */
const LIMITS = { genuine: { min: 4, max: 20 }, impostor: { min: 3, max: 20 }, attack: { min: 1, max: 20 }, minPeople: 2 } as const;
const CALIBRATION_FILE_NAME = /^[A-Za-z0-9]{1,20}_[0-9]{1,3}\.(?:jpe?g|png)$/i;

const FAILED_REASON = 'Não foi possível reconhecer rostos suficientes nas fotos. Refaça a calibração com boa iluminação e o rosto de frente.';

export interface TotemServiceDeps {
  db: Database;
  clock: Clock;
  engine: FacialEngineClient | null;
  engineDefaults: { recognitionThreshold: number; livenessThreshold: number };
  enrollment: FacialEnrollmentService;
}

/** `X-Totem-Version`: texto curto e simples, senão ignorado. */
export function sanitizeAppVersion(raw: string | string[] | undefined): string | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value && /^[\w.+\- ]{1,40}$/.test(value) ? value : null;
}

const deviceActor = (device: DeviceContext): EnrollmentActor => ({
  tenantId: device.tenantId,
  userId: null,
  deviceId: device.deviceId,
  establishmentScope: [device.establishmentId],
});

const sniff = (data: Buffer) => IMAGE_TYPES.find((t) => data.subarray(0, t.magic.length).equals(t.magic));

interface ParsedCalibration {
  sessionId: number;
  genuine: CalibrationImage[];
  impostor: CalibrationImage[];
  attack: CalibrationImage[];
}

async function parseCalibration(req: FastifyRequest): Promise<ParsedCalibration> {
  if (!req.isMultipart()) throw new HttpError(400, 'VALIDATION_ERROR', 'A requisição deve ser multipart/form-data');
  let sessionRaw: string | undefined;
  const groups: Record<'genuine' | 'impostor' | 'attack', CalibrationImage[]> = { genuine: [], impostor: [], attack: [] };
  // o limite global do multipart (6 arquivos) é do cadastro; a calibração leva até 60 fotos
  for await (const part of req.parts({ limits: { files: 60, parts: 70 } })) {
    if (part.type === 'file') {
      const data = await part.toBuffer();
      const group = part.fieldname;
      if (group !== 'genuine' && group !== 'impostor' && group !== 'attack') throw new HttpError(400, 'VALIDATION_ERROR', 'Campo de foto desconhecido');
      const type = sniff(data);
      if (!type) throw new HttpError(400, 'ARQUIVO_INVALIDO', 'As fotos devem ser JPEG ou PNG');
      const index = groups[group].length + 1;
      // só o nome da pessoa (p1_1.jpg) importa à engine; os outros grupos recebem nome próprio
      let filename: string;
      if (group === 'genuine') {
        if (!CALIBRATION_FILE_NAME.test(part.filename ?? '')) throw new HttpError(400, 'VALIDATION_ERROR', 'Nome de foto inválido (use p1_1.jpg, p2_1.jpg...)');
        filename = part.filename!;
      } else {
        filename = `${group === 'impostor' ? 'i' : 'a'}${index}.jpg`;
      }
      groups[group].push({ data, mime: type.mime, filename });
    } else if (part.fieldname === 'sessionId') {
      sessionRaw = String(part.value);
    }
  }
  const sessionId = positiveId.safeParse(sessionRaw);
  if (!sessionId.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'sessionId', message: 'campo inválido' }]);
  return { sessionId: sessionId.data, ...groups };
}

function assertCounts(c: ParsedCalibration): void {
  const bad = (path: string, message: string) => new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path, message }]);
  if (c.genuine.length < LIMITS.genuine.min || c.genuine.length > LIMITS.genuine.max) throw bad('genuine', `de ${LIMITS.genuine.min} a ${LIMITS.genuine.max} fotos`);
  if (new Set(c.genuine.map((g) => personOfCalibrationFile(g.filename))).size < LIMITS.minPeople) throw bad('genuine', 'fotos de pelo menos 2 pessoas');
  if (c.impostor.length < LIMITS.impostor.min || c.impostor.length > LIMITS.impostor.max) throw bad('impostor', `de ${LIMITS.impostor.min} a ${LIMITS.impostor.max} fotos`);
  if (c.attack.length < LIMITS.attack.min || c.attack.length > LIMITS.attack.max) throw bad('attack', `de ${LIMITS.attack.min} a ${LIMITS.attack.max} fotos`);
}

export class TotemService {
  constructor(private readonly d: TotemServiceDeps) {}

  async context(device: DeviceContext, appVersion: string | null) {
    const now = this.d.clock.now();
    const [row] = await this.d.db
      .select({ name: devices.name, lastConnectionAt: devices.lastConnectionAt, establishmentName: establishments.name })
      .from(devices)
      .innerJoin(establishments, and(eq(establishments.tenantId, devices.tenantId), eq(establishments.id, devices.establishmentId)))
      .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, device.deviceId)))
      .limit(1);
    if (!row) throw notFound('Aparelho');

    await this.d.db
      .update(devices)
      .set({ lastConnectionAt: now, ...(appVersion !== null ? { appVersion } : {}) })
      .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, device.deviceId)));
    if (!row.lastConnectionAt || now.getTime() - row.lastConnectionAt.getTime() >= CONNECTION_EVENT_INTERVAL_MS) {
      await this.d.db.insert(deviceEvents).values({ tenantId: device.tenantId, deviceId: device.deviceId, type: 'conexao', description: 'Totem conectado', createdAt: now });
    }

    const [session] = await this.d.db
      .select({ id: calibrationSessions.id, status: calibrationSessions.status })
      .from(calibrationSessions)
      .where(and(eq(calibrationSessions.tenantId, device.tenantId), eq(calibrationSessions.deviceId, device.deviceId), eq(calibrationSessions.status, 'aguardando')))
      .limit(1);

    return {
      device: { id: device.deviceId, name: row.name },
      establishment: { id: device.establishmentId, name: row.establishmentName },
      calibration: session ? { sessionId: session.id, status: 'aguardando' as const } : null,
      serverTime: now.toISOString(),
    };
  }

  identify(device: DeviceContext, ip: string, body: { cpf: string; pin: string }) {
    return this.d.enrollment.identifyAs(deviceActor(device), ip, body.cpf, body.pin);
  }

  async enroll(device: DeviceContext, req: FastifyRequest) {
    const done = await this.d.enrollment.enrollAs(deviceActor(device), req);
    return { enrolledAt: done.enrolledAt, imagesProcessed: done.imagesProcessed };
  }

  async submitCalibration(device: DeviceContext, req: FastifyRequest): Promise<{ status: 'calculada' | 'falhou' }> {
    const input = await parseCalibration(req);
    const where = and(eq(calibrationSessions.tenantId, device.tenantId), eq(calibrationSessions.deviceId, device.deviceId), eq(calibrationSessions.id, input.sessionId));
    const [session] = await this.d.db.select({ status: calibrationSessions.status }).from(calibrationSessions).where(where).limit(1);
    // sessão de outro aparelho ou de outra conta = 404, como se não existisse
    if (!session) throw notFound('Calibração');
    if (session.status !== 'aguardando') throw new HttpError(409, 'CALIBRACAO_NAO_AGUARDANDO', 'Esta calibração não está aguardando fotos');
    assertCounts(input);
    if (!this.d.engine) throw new HttpError(503, 'MOTOR_FACIAL_INDISPONIVEL', 'O reconhecimento facial está indisponível. Tente mais tarde');

    const [current] = await this.d.db
      .select({ recognition: devices.recognitionThreshold, liveness: devices.livenessThreshold })
      .from(devices)
      .where(and(eq(devices.tenantId, device.tenantId), eq(devices.id, device.deviceId)));

    let outcome: { status: 'calculada'; result: ReturnType<typeof buildCalibrationResult> } | { status: 'falhou' };
    try {
      const [recognition, liveness] = await Promise.all([
        this.d.engine.calibrateRecognition({ legitimate: input.genuine, impostor: input.impostor }),
        this.d.engine.calibrateLiveness({ real: input.genuine, attack: input.attack }),
      ]);
      outcome = {
        status: 'calculada',
        result: buildCalibrationResult({
          current: {
            recognitionThreshold: current?.recognition ?? this.d.engineDefaults.recognitionThreshold,
            livenessThreshold: current?.liveness ?? this.d.engineDefaults.livenessThreshold,
          },
          recognition,
          liveness,
        }),
      };
    } catch (err) {
      // o texto da engine nunca é repassado; indisponível não gasta a sessão (o totem tenta de novo)
      if (err instanceof EngineRejectedError) outcome = { status: 'falhou' };
      else if (err instanceof EngineUnavailableError) throw new HttpError(503, 'MOTOR_FACIAL_INDISPONIVEL', 'O reconhecimento facial está indisponível. Tente mais tarde');
      else throw err;
    }

    const now = this.d.clock.now();
    await this.d.db.transaction(async (tx) => {
      const [done] = await tx
        .update(calibrationSessions)
        .set({ status: outcome.status, computedAt: now, result: outcome.status === 'calculada' ? outcome.result : { failureReason: FAILED_REASON } })
        .where(and(where, eq(calibrationSessions.status, 'aguardando')))
        .returning({ id: calibrationSessions.id });
      if (!done) throw new HttpError(409, 'CALIBRACAO_NAO_AGUARDANDO', 'Esta calibração não está aguardando fotos');
      await tx.insert(deviceEvents).values({
        tenantId: device.tenantId,
        deviceId: device.deviceId,
        type: 'calibracao',
        description: outcome.status === 'calculada' ? 'Calibração calculada, aguardando aplicação' : 'Calibração falhou',
        createdAt: now,
      });
      await recordAudit(tx, this.d.clock, {
        tenantId: device.tenantId,
        userId: null,
        entity: 'aparelhos',
        entityId: device.deviceId,
        action: 'alteracao',
        after: { event: 'device.calibration_computed', sessionId: input.sessionId, status: outcome.status },
      });
    });
    return { status: outcome.status };
  }
}
