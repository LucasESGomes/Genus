/**
 * Fechamento da competência e espelho de ponto (G10, RF46 a RF49).
 *
 * - Fechar trava a apuração e os ajustes do período (trigger
 *   fn_bloqueia_periodo_fechado). Antes, a api recusa se houver inconsistência
 *   aberta ou ajuste pendente no período: 409 FECHAMENTO_COM_PENDENCIAS [A CONFIRMAR].
 * - Reabrir exige motivo (CHECK fech_reabertura_coerente), vai para a auditoria
 *   e apaga a ciência dos espelhos: o colaborador precisa dar ciência de novo (04 G10).
 * - O espelho é montado na leitura a partir da apuração gravada; a linha em
 *   `espelhos` registra que ele foi emitido e guarda a ciência (RF48).
 * - A auditoria é imutável (trg_auditoria_imutavel).
 */
import { maskCpf, type Clock } from '@genus/shared';
import { and, asc, between, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import { closingPeriods, dailyTimesheets, employees, establishments, timeAdjustments, timeBankBalances, timeBankEntries, timeMirrors, timesheetIssues } from '../../db/schema';
import { establishmentInScope, FULL_CPF_ROLES, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope } from '../employees/lookup';
import { addDays, addMonths } from '../rules-common/rules/civil-time';
import type { DayPostingHook } from '../time-bank/posting-hook';
import { TimesheetService } from '../timesheets/service';
import type { closingDto, createClosingBody, mirrorDto } from './schemas';

const BLOCKING_ISSUES = ['batidas_impares', 'marcacao_duplicada'];

type ClosingRow = typeof closingPeriods.$inferSelect;
type ClosingDto = z.infer<typeof closingDto>;

const toDto = (r: ClosingRow): ClosingDto => ({
  id: r.id,
  establishmentId: r.establishmentId,
  referenceMonth: r.referenceMonth.slice(0, 7),
  startDate: r.startDate,
  endDate: r.endDate,
  status: r.status as ClosingDto['status'],
  closedAt: r.closedAt?.toISOString() ?? null,
  reopenedAt: r.reopenedAt?.toISOString() ?? null,
  reopenReason: r.reopenReason,
});

export interface ClosingServiceDeps {
  /** Repassado à apuração: o recálculo lança no banco de horas. */
  posting?: DayPostingHook;
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
}

export class ClosingService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: ClosingServiceDeps) {
    this.timesheets = new TimesheetService(d);
  }

  private async load(ctx: RequestContext, id: number): Promise<ClosingRow> {
    const [row] = await this.d.db
      .select()
      .from(closingPeriods)
      .where(and(eq(closingPeriods.tenantId, tenantOf(ctx)), eq(closingPeriods.id, id)))
      .limit(1);
    if (!row || !establishmentInScope(ctx, row.establishmentId)) throw notFound('Fechamento');
    return row;
  }

  async list(ctx: RequestContext, establishmentId?: number): Promise<ClosingDto[]> {
    const rows = await this.d.db
      .select()
      .from(closingPeriods)
      .where(and(eq(closingPeriods.tenantId, tenantOf(ctx)), establishmentId ? eq(closingPeriods.establishmentId, establishmentId) : undefined))
      .orderBy(asc(closingPeriods.referenceMonth), asc(closingPeriods.id));
    return rows.filter((r) => establishmentInScope(ctx, r.establishmentId)).map(toDto);
  }

  async create(ctx: RequestContext, body: z.infer<typeof createClosingBody>): Promise<ClosingDto> {
    const tenantId = tenantOf(ctx);
    const [est] = await this.d.db
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, body.establishmentId)));
    if (!est || !establishmentInScope(ctx, est.id)) {
      throw new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'establishmentId', message: 'estabelecimento não encontrado' }]);
    }
    const start = `${body.referenceMonth}-01`;
    const end = addDays(addMonths(start, 1), -1);
    const row = await this.d.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(closingPeriods)
        .values({ tenantId, establishmentId: est.id, referenceMonth: start, startDate: start, endDate: end })
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'fechamentos',
        entityId: created!.id,
        action: 'criacao',
        after: { establishmentId: est.id, referenceMonth: body.referenceMonth },
      });
      return created!;
    });
    return toDto(row);
  }

  /**
   * Quantas pendências travam o fechamento: inconsistência que impede o cálculo (batida ímpar ou
   * duplicada, dia `inconsistente`) e ajuste pendente no período. As demais (intervalo, interjornada,
   * extra acima do limite) só sinalizam e não travam [A CONFIRMAR].
   */
  private async pendingCount(tx: Parameters<Parameters<Database['transaction']>[0]>[0], c: ClosingRow) {
    const inEst = and(eq(employees.tenantId, c.tenantId), eq(employees.establishmentId, c.establishmentId));
    const [issues] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(timesheetIssues)
      .innerJoin(dailyTimesheets, and(eq(dailyTimesheets.tenantId, timesheetIssues.tenantId), eq(dailyTimesheets.id, timesheetIssues.dailyTimesheetId)))
      .innerJoin(employees, and(eq(employees.tenantId, dailyTimesheets.tenantId), eq(employees.id, dailyTimesheets.employeeId)))
      .where(and(eq(timesheetIssues.tenantId, c.tenantId), eq(timesheetIssues.isResolved, false), inArray(timesheetIssues.type, BLOCKING_ISSUES), between(dailyTimesheets.date, c.startDate, c.endDate), inEst));
    const [adjustments] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(timeAdjustments)
      .innerJoin(employees, and(eq(employees.tenantId, timeAdjustments.tenantId), eq(employees.id, timeAdjustments.employeeId)))
      .where(and(eq(timeAdjustments.tenantId, c.tenantId), eq(timeAdjustments.status, 'pendente'), between(timeAdjustments.date, c.startDate, c.endDate), inEst));
    return { issues: issues?.n ?? 0, adjustments: adjustments?.n ?? 0 };
  }

  async close(ctx: RequestContext, id: number): Promise<ClosingDto> {
    const current = await this.load(ctx, id);
    const row = await this.d.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(closingPeriods).where(and(eq(closingPeriods.tenantId, current.tenantId), eq(closingPeriods.id, id))).for('update');
      if (locked!.status === 'fechado') throw new HttpError(409, 'STATUS_INVALIDO', 'A competência já está fechada');
      const pending = await this.pendingCount(tx, locked!);
      if (pending.issues + pending.adjustments > 0) {
        throw new HttpError(409, 'FECHAMENTO_COM_PENDENCIAS', 'Há inconsistências abertas ou ajustes pendentes no período', [
          { path: 'issues', message: String(pending.issues) },
          { path: 'adjustments', message: String(pending.adjustments) },
        ]);
      }
      const [after] = await tx
        .update(closingPeriods)
        .set({ status: 'fechado', closedById: ctx.userId, closedAt: this.d.clock.now() })
        .where(and(eq(closingPeriods.tenantId, current.tenantId), eq(closingPeriods.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId: current.tenantId,
        userId: ctx.userId,
        entity: 'fechamentos',
        entityId: id,
        action: 'fechamento',
        before: { status: locked!.status },
        after: { status: 'fechado' },
      });
      return after!;
    });
    return toDto(row);
  }

  async reopen(ctx: RequestContext, id: number, reason: string): Promise<ClosingDto> {
    const current = await this.load(ctx, id);
    const row = await this.d.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(closingPeriods).where(and(eq(closingPeriods.tenantId, current.tenantId), eq(closingPeriods.id, id))).for('update');
      if (locked!.status !== 'fechado') throw new HttpError(409, 'STATUS_INVALIDO', 'Só uma competência fechada pode ser reaberta');
      const [after] = await tx
        .update(closingPeriods)
        .set({ status: 'reaberto', reopenedById: ctx.userId, reopenedAt: this.d.clock.now(), reopenReason: reason })
        .where(and(eq(closingPeriods.tenantId, current.tenantId), eq(closingPeriods.id, id)))
        .returning();
      // Reabrir invalida a ciência (04 G10): o espelho pode mudar
      const cleared = await tx
        .update(timeMirrors)
        .set({ acknowledgedAt: null, acknowledgedIp: null })
        .where(and(eq(timeMirrors.tenantId, current.tenantId), eq(timeMirrors.closingPeriodId, id), sql`${timeMirrors.acknowledgedAt} IS NOT NULL`))
        .returning({ id: timeMirrors.id });
      await recordAudit(tx, this.d.clock, {
        tenantId: current.tenantId,
        userId: ctx.userId,
        entity: 'fechamentos',
        entityId: id,
        action: 'reabertura',
        before: { status: 'fechado' },
        after: { status: 'reaberto', acknowledgmentsCleared: cleared.length },
        reason,
      });
      return after!;
    });
    return toDto(row);
  }

  /** Emite o espelho de cada colaborador ativo no período (idempotente). Só com a competência fechada. */
  async generateMirrors(ctx: RequestContext, id: number) {
    const c = await this.load(ctx, id);
    if (c.status !== 'fechado') throw new HttpError(409, 'STATUS_INVALIDO', 'Feche a competência antes de emitir os espelhos');
    return this.d.db.transaction(async (tx) => {
      const people = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, c.tenantId),
            eq(employees.establishmentId, c.establishmentId),
            lte(employees.admissionDate, c.endDate),
            or(isNull(employees.terminationDate), gte(employees.terminationDate, c.startDate)),
          ),
        );
      if (people.length === 0) return { generated: 0, total: 0 };
      const inserted = await tx
        .insert(timeMirrors)
        .values(people.map((p) => ({ tenantId: c.tenantId, closingPeriodId: c.id, employeeId: p.id })))
        .onConflictDoNothing({ target: [timeMirrors.closingPeriodId, timeMirrors.employeeId] })
        .returning({ id: timeMirrors.id });
      await recordAudit(tx, this.d.clock, {
        tenantId: c.tenantId,
        userId: ctx.userId,
        entity: 'fechamentos',
        entityId: c.id,
        action: 'alteracao',
        after: { event: 'closing.mirrors_generated', generated: inserted.length },
      });
      return { generated: inserted.length, total: people.length };
    });
  }

  private async buildMirror(ctx: RequestContext, c: ClosingRow, employeeId: number): Promise<z.infer<typeof mirrorDto>> {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const [mirror] = await this.d.db
      .select()
      .from(timeMirrors)
      .where(and(eq(timeMirrors.tenantId, c.tenantId), eq(timeMirrors.closingPeriodId, c.id), eq(timeMirrors.employeeId, emp.id)));
    if (!mirror) throw notFound('Espelho');
    const [days, [balance], entries, [extra]] = await Promise.all([
      this.timesheets.listFor(this.d.db, c.tenantId, emp.id, c.startDate, c.endDate),
      this.d.db.select().from(timeBankBalances).where(and(eq(timeBankBalances.tenantId, c.tenantId), eq(timeBankBalances.employeeId, emp.id))),
      this.d.db
        .select({ date: timeBankEntries.referenceDate, type: timeBankEntries.type, minutes: timeBankEntries.minutes })
        .from(timeBankEntries)
        .where(and(eq(timeBankEntries.tenantId, c.tenantId), eq(timeBankEntries.employeeId, emp.id), between(timeBankEntries.referenceDate, c.startDate, c.endDate)))
        .orderBy(asc(timeBankEntries.referenceDate), asc(timeBankEntries.id)),
      this.d.db.select({ registrationNumber: employees.registrationNumber }).from(employees).where(and(eq(employees.tenantId, c.tenantId), eq(employees.id, emp.id))),
    ]);
    const sum = (k: 'expectedMinutes' | 'workedMinutes' | 'absenceMinutes' | 'lateMinutes' | 'overtime50Minutes' | 'overtime100Minutes' | 'nightMinutes') =>
      days.reduce((s, d) => s + d[k], 0);
    const fullCpf = (FULL_CPF_ROLES as readonly string[]).includes(ctx.role) || ctx.employeeId === emp.id;
    return {
      closing: toDto(c),
      employee: { id: emp.id, name: emp.name, cpf: fullCpf ? emp.cpf : maskCpf(emp.cpf), registrationNumber: extra?.registrationNumber ?? null },
      days,
      totals: {
        expectedMinutes: sum('expectedMinutes'),
        workedMinutes: sum('workedMinutes'),
        absenceMinutes: sum('absenceMinutes'),
        lateMinutes: sum('lateMinutes'),
        overtime50Minutes: sum('overtime50Minutes'),
        overtime100Minutes: sum('overtime100Minutes'),
        nightMinutes: sum('nightMinutes'),
      },
      timeBank: { balanceMinutes: balance?.balanceMinutes ?? 0, periodEntries: entries },
      pdfUrl: mirror.pdfUrl,
      acknowledgedAt: mirror.acknowledgedAt?.toISOString() ?? null,
    };
  }

  async mirror(ctx: RequestContext, id: number, employeeId: number) {
    return this.buildMirror(ctx, await this.load(ctx, id), employeeId);
  }

  // ------------------------------------------------------------------ portal do colaborador

  async myMirrors(ctx: RequestContext) {
    const employeeId = selfId(ctx);
    const rows = await this.d.db
      .select({ c: closingPeriods, acknowledgedAt: timeMirrors.acknowledgedAt })
      .from(timeMirrors)
      .innerJoin(closingPeriods, and(eq(closingPeriods.tenantId, timeMirrors.tenantId), eq(closingPeriods.id, timeMirrors.closingPeriodId)))
      .where(and(eq(timeMirrors.tenantId, tenantOf(ctx)), eq(timeMirrors.employeeId, employeeId)))
      .orderBy(asc(closingPeriods.referenceMonth));
    return rows.map((r) => ({
      closingId: r.c.id,
      referenceMonth: r.c.referenceMonth.slice(0, 7),
      status: r.c.status as ClosingDto['status'],
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    }));
  }

  private async myClosing(ctx: RequestContext, closingId: number): Promise<ClosingRow> {
    const [row] = await this.d.db
      .select({ c: closingPeriods })
      .from(timeMirrors)
      .innerJoin(closingPeriods, and(eq(closingPeriods.tenantId, timeMirrors.tenantId), eq(closingPeriods.id, timeMirrors.closingPeriodId)))
      .where(and(eq(timeMirrors.tenantId, tenantOf(ctx)), eq(timeMirrors.employeeId, selfId(ctx)), eq(timeMirrors.closingPeriodId, closingId)));
    if (!row) throw notFound('Espelho');
    return row.c;
  }

  async myMirror(ctx: RequestContext, closingId: number) {
    return this.buildMirror(ctx, await this.myClosing(ctx, closingId), selfId(ctx));
  }

  /** RF48: ciência do colaborador, com instante e IP. Só em competência fechada. */
  async acknowledge(ctx: RequestContext, closingId: number, ip: string) {
    const c = await this.myClosing(ctx, closingId);
    if (c.status !== 'fechado') throw new HttpError(409, 'STATUS_INVALIDO', 'A competência foi reaberta: aguarde o novo fechamento');
    const now = this.d.clock.now();
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .update(timeMirrors)
        .set({ acknowledgedAt: now, acknowledgedIp: ip })
        .where(and(eq(timeMirrors.tenantId, c.tenantId), eq(timeMirrors.closingPeriodId, c.id), eq(timeMirrors.employeeId, selfId(ctx)), isNull(timeMirrors.acknowledgedAt)))
        .returning({ id: timeMirrors.id, at: timeMirrors.acknowledgedAt });
      if (!row) throw new HttpError(409, 'STATUS_INVALIDO', 'A ciência deste espelho já foi registrada');
      await recordAudit(tx, this.d.clock, {
        tenantId: c.tenantId,
        userId: ctx.userId,
        entity: 'espelhos',
        entityId: row.id,
        action: 'alteracao',
        after: { event: 'mirror.acknowledged', ip },
      });
      return { closingId: c.id, acknowledgedAt: row.at!.toISOString() };
    });
  }

}

function selfId(ctx: RequestContext): number {
  if (ctx.employeeId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
  return ctx.employeeId;
}
