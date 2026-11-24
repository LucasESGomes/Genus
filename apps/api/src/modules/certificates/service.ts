/**
 * Atestados (G7, RF27, RF28, RF32). Dado de saúde (RN15, LGPD art. 11).
 *
 * - O colaborador envia (RF27): o arquivo vai para o `FileStorage` com chave
 *   `contas/{conta}/atestados/{sha256}`, o `arquivo_hash` é o SHA-256 e o status
 *   nasce `pendente` (o schema não tem `recebido`). Sem análise nesta etapa.
 *   O mesmo arquivo de novo: 409 ATESTADO_DUPLICADO (atestado_arquivo_unico).
 * - Só o RH aprova ou recusa; o admin não (04 §1.4, §7.1). Aprovar com dias
 *   cria o afastamento `atestado` (afast_sem_sobreposicao vale).
 * - Só o RH baixa o arquivo, e todo download vai para a auditoria
 *   (`leitura_sensivel`, security-lgpd §3.5).
 * - CID não é gravado nem devolvido nesta etapa: a coluna `cid_cifrado` fica nula.
 */
import { createHash } from 'node:crypto';
import type { Clock } from '@genus/shared';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import { employees, medicalCertificates } from '../../db/schema';
import { employeeScopeConditions, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import type { FileStorage } from '../../storage/file-storage';
import { AbsenceService } from '../absences/service';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope } from '../employees/lookup';
import { addDays } from '../rules-common/rules/civil-time';
import type { certificateDto, certificateRhDto, listCertificatesQuery, myCertificateDto } from './schemas';
import { submitCertificateFields } from './schemas';

type Row = typeof medicalCertificates.$inferSelect;
type CommonDto = z.infer<typeof certificateDto>;

const FILE_TYPES = [
  { mime: 'application/pdf', ext: 'pdf', magic: Buffer.from('%PDF-') },
  { mime: 'image/jpeg', ext: 'jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', ext: 'png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
] as const;

function common(r: Row): CommonDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    startDate: r.startDate,
    days: r.days,
    hours: r.hours,
    status: r.status as CommonDto['status'],
    sentAt: r.sentAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

function rhView(r: Row): z.infer<typeof certificateRhDto> {
  return {
    ...common(r),
    doctorName: r.doctorName,
    doctorCrm: r.doctorCrm,
    doctorCrmUf: r.doctorCrmUf,
    decisionReason: r.decisionReason,
    fileUrl: `/portal/certificates/${r.id}/file`,
  };
}

const mine = (r: Row): z.infer<typeof myCertificateDto> => ({ ...common(r), decisionReason: r.decisionReason });

export interface CertificateServiceDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
  storage: FileStorage;
}

export class CertificateService {
  private readonly absences: AbsenceService;

  constructor(private readonly d: CertificateServiceDeps) {
    this.absences = new AbsenceService(d);
  }

  async list(ctx: RequestContext, q: z.infer<typeof listCertificatesQuery>) {
    const conds: SQL[] = [...employeeScopeConditions(ctx), eq(medicalCertificates.tenantId, tenantOf(ctx))];
    if (q.status) conds.push(eq(medicalCertificates.status, q.status));
    if (q.employeeId) conds.push(eq(medicalCertificates.employeeId, q.employeeId));
    const where = and(...conds);
    const join = and(eq(employees.tenantId, medicalCertificates.tenantId), eq(employees.id, medicalCertificates.employeeId));
    const [rows, [total]] = await Promise.all([
      this.d.db
        .select({ c: medicalCertificates })
        .from(medicalCertificates)
        .innerJoin(employees, join)
        .where(where)
        .orderBy(desc(medicalCertificates.sentAt), desc(medicalCertificates.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.d.db.select({ n: count() }).from(medicalCertificates).innerJoin(employees, join).where(where),
    ]);
    const view = ctx.role === 'rh' ? rhView : common;
    return { data: rows.map((r) => view(r.c)), meta: { page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 } };
  }

  /** Atestado da conta e no escopo de quem pede; senão 404. */
  private async load(ctx: RequestContext, id: number) {
    const [row] = await this.d.db
      .select()
      .from(medicalCertificates)
      .where(and(eq(medicalCertificates.tenantId, tenantOf(ctx)), eq(medicalCertificates.id, id)))
      .limit(1);
    if (!row) throw notFound('Atestado');
    const emp = await findEmployeeInScope(this.d.db, ctx, row.employeeId).catch(() => {
      throw notFound('Atestado');
    });
    return { row, emp };
  }

  async file(ctx: RequestContext, id: number, ip: string): Promise<{ data: Buffer; mime: string }> {
    const { row, emp } = await this.load(ctx, id);
    const data = await this.d.storage.get(row.fileUrl);
    if (!data) throw notFound('Arquivo');
    await recordAudit(this.d.db, this.d.clock, {
      tenantId: emp.tenantId,
      userId: ctx.userId,
      entity: 'atestados',
      entityId: id,
      action: 'leitura_sensivel',
      after: { event: 'certificate.file_downloaded', ip },
    });
    const type = FILE_TYPES.find((t) => row.fileUrl.endsWith(`.${t.ext}`));
    return { data, mime: type?.mime ?? 'application/octet-stream' };
  }

  async decide(ctx: RequestContext, id: number, decision: { approve: true } | { approve: false; reason: string }) {
    const { row, emp } = await this.load(ctx, id);
    const updated = await this.d.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: medicalCertificates.status })
        .from(medicalCertificates)
        .where(and(eq(medicalCertificates.tenantId, emp.tenantId), eq(medicalCertificates.id, id)))
        .for('update');
      if (locked!.status !== 'pendente') throw new HttpError(409, 'STATUS_INVALIDO', 'O atestado já foi decidido');
      const [after] = await tx
        .update(medicalCertificates)
        .set({
          status: decision.approve ? 'aprovado' : 'recusado',
          decidedById: ctx.userId,
          decidedAt: this.d.clock.now(),
          decisionReason: decision.approve ? null : decision.reason,
        })
        .where(and(eq(medicalCertificates.tenantId, emp.tenantId), eq(medicalCertificates.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'atestados',
        entityId: id,
        action: decision.approve ? 'aprovacao' : 'recusa',
        before: { status: 'pendente' },
        after: { status: after!.status },
        reason: decision.approve ? null : decision.reason,
      });
      // Atestado por dias afasta o colaborador; por horas só abona parte do dia (G8) [A CONFIRMAR]
      if (decision.approve && row.days !== null) {
        await this.absences.insert(tx, ctx, emp, {
          type: 'atestado',
          startDate: row.startDate,
          endDate: addDays(row.startDate, row.days - 1),
          certificateId: id,
        });
      }
      return after!;
    });
    return rhView(updated);
  }

  // ------------------------------------------------------------------ portal do colaborador

  async listMine(ctx: RequestContext) {
    const employeeId = selfId(ctx);
    const rows = await this.d.db
      .select()
      .from(medicalCertificates)
      .where(and(eq(medicalCertificates.tenantId, tenantOf(ctx)), eq(medicalCertificates.employeeId, employeeId)))
      .orderBy(desc(medicalCertificates.sentAt));
    return rows.map(mine);
  }

  async submit(ctx: RequestContext, req: FastifyRequest) {
    const employeeId = selfId(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const { file, fields } = await parseUpload(req);
    const type = FILE_TYPES.find((t) => file.subarray(0, t.magic.length).equals(t.magic));
    if (!type) throw new HttpError(400, 'ARQUIVO_INVALIDO', 'Envie o atestado em PDF, JPEG ou PNG');
    const hash = createHash('sha256').update(file).digest('hex');
    const key = `contas/${emp.tenantId}/atestados/${hash}.${type.ext}`;
    await this.d.storage.put(key, file);
    const row = await this.d.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(medicalCertificates)
        .values({
          tenantId: emp.tenantId,
          employeeId,
          startDate: fields.startDate,
          days: fields.days ?? null,
          hours: fields.hours ?? null,
          fileUrl: key,
          fileHash: hash,
          doctorName: fields.doctorName ?? null,
          doctorCrm: fields.doctorCrm ?? null,
          doctorCrmUf: fields.doctorCrmUf ?? null,
          sentAt: this.d.clock.now(),
        })
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'atestados',
        entityId: created!.id,
        action: 'criacao',
        after: { startDate: fields.startDate, days: fields.days ?? null, hours: fields.hours ?? null },
      });
      return created!;
    });
    return mine(row);
  }
}

function selfId(ctx: RequestContext): number {
  if (ctx.employeeId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
  return ctx.employeeId;
}

const FIELD_NAMES = ['startDate', 'days', 'hours', 'doctorName', 'doctorCrm', 'doctorCrmUf'] as const;

async function parseUpload(req: FastifyRequest): Promise<{ file: Buffer; fields: z.infer<typeof submitCertificateFields> }> {
  if (!req.isMultipart()) throw new HttpError(400, 'VALIDATION_ERROR', 'A requisição deve ser multipart/form-data');
  let file: Buffer | null = null;
  const raw: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const data = await part.toBuffer(); // acima do limite: 413 (error handler)
      if (part.fieldname !== 'file' || file) throw new HttpError(400, 'VALIDATION_ERROR', 'Envie um único arquivo no campo file');
      file = data;
    } else if ((FIELD_NAMES as readonly string[]).includes(part.fieldname)) {
      if (part.valueTruncated) throw new HttpError(400, 'VALIDATION_ERROR', 'Campo muito longo', [{ path: part.fieldname, message: 'valor longo demais' }]);
      raw[part.fieldname] = String(part.value);
    }
  }
  if (!file || file.length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Arquivo obrigatório', [{ path: 'file', message: 'envie o atestado' }]);
  const parsed = submitCertificateFields.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Requisição inválida',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return { file, fields: parsed.data };
}
