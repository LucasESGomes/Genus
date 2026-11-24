/**
 * Férias (G9, RF39 a RF43, RN10 a RN12).
 *
 * - Período aquisitivo: 12 meses a partir do início; concessivo nos 12 seguintes.
 *   `dias_direito` sai de `vacationEntitlementDays` (RN10) com as faltas
 *   injustificadas da apuração; o CHECK pa_direito_bate_faltas confere no banco.
 * - Pedido e aprovação passam por `validateVacationRequest` (fracionamento,
 *   saldo, abono, início vedado, aviso, sobreposição e setor desfalcado).
 * - A aprovação valida com a contagem atual do setor; o trigger
 *   trg_ferias_limite_setor (que trava o setor com FOR UPDATE) continua sendo a
 *   garantia final contra duas aprovações simultâneas (409 FERIAS_SETOR_DESFALCADO).
 */
import type { Clock } from '@genus/shared';
import { and, asc, between, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import type { Executor } from '../../db/executor';
import {
  dailyTimesheets,
  departments,
  employeeAssignments,
  employeeSchedules,
  holidays,
  schedules,
  vacationAccrualPeriods,
  vacationInstallments,
} from '../../db/schema';
import { notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope, type EmployeeRecord } from '../employees/lookup';
import { loadLegalParameters } from '../legal-parameters/repository';
import { addDays, addMonths, isoWeekday, type CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import { resolveScheduleDay, type ScheduleDef } from '../schedules/rules/day-schedule';
import { loadScheduleDays } from '../schedules/service';
import { vacationEntitlementDays } from './rules/entitlement';
import { assertVacationRequest, daysPaidInDouble, periodDays, type VacationPeriod } from './rules/request';
import type { accrualPeriodDto, createAccrualPeriodBody, requestVacationBody, vacationDto } from './schemas';

type VacationDto = z.infer<typeof vacationDto>;
type InstallmentRow = typeof vacationInstallments.$inferSelect;
const ACTIVE = ['aprovada', 'gozada'] as const;

function toVacationDto(r: InstallmentRow, grantDeadline: CivilDate): VacationDto {
  return {
    id: r.id,
    accrualPeriodId: r.accrualPeriodId,
    employeeId: r.employeeId,
    departmentId: r.departmentId,
    startDate: r.startDate,
    endDate: r.endDate,
    days: r.days ?? periodDays({ start: r.startDate, end: r.endDate }),
    cashBonusDays: r.cashBonusDays,
    status: r.status as VacationDto['status'],
    requestedAt: r.requestedAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionReason: r.decisionReason,
    daysPaidInDouble: daysPaidInDouble({ start: r.startDate, end: r.endDate }, grantDeadline),
  };
}

const asPeriod = (r: { startDate: string; endDate: string; cashBonusDays: number }): VacationPeriod => ({
  start: r.startDate,
  end: r.endDate,
  cashAllowanceDays: r.cashBonusDays,
});

export interface VacationServiceDeps {
  db: Database;
  clock: Clock;
}

export class VacationService {
  constructor(private readonly d: VacationServiceDeps) {}

  private today(emp: EmployeeRecord): CivilDate {
    return toCivilDate(this.d.clock.now(), timezoneForUf(emp.uf));
  }

  /** Faltas injustificadas do período: dias `falta` da apuração sem abono ou justificativa aprovados. */
  private async unjustifiedAbsences(ex: Executor, emp: EmployeeRecord, from: CivilDate, to: CivilDate): Promise<number> {
    const [row] = await ex
      .select({ n: sql<number>`count(*)::int` })
      .from(dailyTimesheets)
      .where(
        and(
          eq(dailyTimesheets.tenantId, emp.tenantId),
          eq(dailyTimesheets.employeeId, emp.id),
          eq(dailyTimesheets.situation, 'falta'),
          between(dailyTimesheets.date, from, to),
          sql`NOT EXISTS (SELECT 1 FROM rh.ajustes a
                           WHERE a.conta_id = ${emp.tenantId} AND a.colaborador_id = ${emp.id}
                             AND a.data = ${dailyTimesheets.date} AND a.status = 'aprovado'
                             AND a.tipo IN ('abono','justificativa'))`,
        ),
      );
    return row?.n ?? 0;
  }

  async createAccrualPeriod(ctx: RequestContext, employeeId: number, body: z.infer<typeof createAccrualPeriodBody>) {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const start = body.startDate;
    const end = addDays(addMonths(start, 12), -1);
    const grantDeadline = addDays(addMonths(addDays(end, 1), 12), -1);
    const params = await loadLegalParameters(this.d.db, emp.tenantId, emp.companyId);
    const id = await this.d.db.transaction(async (tx) => {
      const absences = await this.unjustifiedAbsences(tx, emp, start, end);
      // RN10: faixas vigentes no fim do período aquisitivo [A CONFIRMAR]
      const entitled = vacationEntitlementDays(absences, params, end, String(emp.companyId));
      const [row] = await tx
        .insert(vacationAccrualPeriods)
        .values({ tenantId: emp.tenantId, employeeId: emp.id, startDate: start, endDate: end, grantDeadline, unjustifiedAbsences: absences, entitledDays: entitled })
        .returning({ id: vacationAccrualPeriods.id });
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'periodos_aquisitivos_ferias',
        entityId: row!.id,
        action: 'criacao',
        after: { startDate: start, endDate: end, unjustifiedAbsences: absences, entitledDays: entitled },
      });
      return row!.id;
    });
    return (await this.periods(emp, id))[0]!;
  }

  private async periods(emp: EmployeeRecord, onlyId?: number): Promise<z.infer<typeof accrualPeriodDto>[]> {
    const periods = await this.d.db
      .select()
      .from(vacationAccrualPeriods)
      .where(
        and(
          eq(vacationAccrualPeriods.tenantId, emp.tenantId),
          eq(vacationAccrualPeriods.employeeId, emp.id),
          onlyId ? eq(vacationAccrualPeriods.id, onlyId) : undefined,
        ),
      )
      .orderBy(asc(vacationAccrualPeriods.startDate));
    if (periods.length === 0) return [];
    const installments = await this.d.db
      .select()
      .from(vacationInstallments)
      .where(and(eq(vacationInstallments.tenantId, emp.tenantId), inArray(vacationInstallments.accrualPeriodId, periods.map((p) => p.id))))
      .orderBy(asc(vacationInstallments.startDate));
    return periods.map((p) => {
      const mine = installments.filter((i) => i.accrualPeriodId === p.id);
      const used = mine.filter((i) => (ACTIVE as readonly string[]).includes(i.status)).reduce((s, i) => s + periodDays(asPeriod(i)) + i.cashBonusDays, 0);
      return {
        id: p.id,
        employeeId: p.employeeId,
        startDate: p.startDate,
        endDate: p.endDate,
        grantDeadline: p.grantDeadline,
        unjustifiedAbsences: p.unjustifiedAbsences,
        entitledDays: p.entitledDays,
        status: p.status,
        remainingDays: p.entitledDays - used,
        vacations: mine.map((i) => toVacationDto(i, p.grantDeadline)),
      };
    });
  }

  async listPeriods(ctx: RequestContext, employeeId: number) {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    return this.periods(emp);
  }

  /** Feriados e folgas da escala de `start` a `start + n` (RN11, art. 134 §3º). */
  private async blockedDays(ex: Executor, emp: EmployeeRecord, start: CivilDate, n: number) {
    const end = addDays(start, n);
    const holidayRows = await ex
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          between(holidays.date, start, end),
          eq(holidays.isOptional, false),
          or(isNull(holidays.tenantId), eq(holidays.tenantId, emp.tenantId)),
          or(
            eq(holidays.scope, 'nacional'),
            and(eq(holidays.scope, 'estadual'), eq(holidays.uf, emp.uf)),
            and(eq(holidays.scope, 'municipal'), eq(holidays.municipalityIbge, emp.municipalityIbge)),
          ),
        ),
      );
    const [assignment] = await ex
      .select({ scheduleId: employeeSchedules.scheduleId, cycleType: schedules.cycleType, cycleDays: schedules.cycleDays, referenceDate: schedules.referenceDate })
      .from(employeeSchedules)
      .innerJoin(schedules, and(eq(schedules.tenantId, employeeSchedules.tenantId), eq(schedules.id, employeeSchedules.scheduleId)))
      .where(
        and(
          eq(employeeSchedules.tenantId, emp.tenantId),
          eq(employeeSchedules.employeeId, emp.id),
          lte(employeeSchedules.validFrom, start),
          or(isNull(employeeSchedules.validTo), gte(employeeSchedules.validTo, start)),
        ),
      )
      .limit(1);
    const restDays: CivilDate[] = [];
    const def: ScheduleDef | null = assignment
      ? {
          cycleType: assignment.cycleType as ScheduleDef['cycleType'],
          cycleDays: assignment.cycleDays,
          referenceDate: assignment.referenceDate,
          days: await loadScheduleDays(ex, emp.tenantId, assignment.scheduleId),
        }
      : null;
    for (let date = start; date <= end; date = addDays(date, 1)) {
      // sem escala: sábado e domingo, como o trigger fn_ferias_inicio_valido
      const off = def ? resolveScheduleDay(def, date).schedule.kind === 'folga' : isoWeekday(date) >= 6;
      if (off) restDays.push(date);
    }
    return { holidays: holidayRows.map((h) => h.date), restDays };
  }

  /** Monta a entrada da regra pura com o estado atual do banco e valida. */
  private async validate(
    ex: Executor,
    emp: EmployeeRecord,
    period: typeof vacationAccrualPeriods.$inferSelect,
    departmentId: number,
    request: VacationPeriod,
    excludeId: number | null,
  ) {
    const params = await loadLegalParameters(ex, emp.tenantId, emp.companyId);
    const active = (extra: ReturnType<typeof and>) =>
      ex
        .select({ startDate: vacationInstallments.startDate, endDate: vacationInstallments.endDate, cashBonusDays: vacationInstallments.cashBonusDays })
        .from(vacationInstallments)
        .where(
          and(
            eq(vacationInstallments.tenantId, emp.tenantId),
            inArray(vacationInstallments.status, [...ACTIVE]),
            excludeId ? ne(vacationInstallments.id, excludeId) : undefined,
            extra,
          ),
        );
    const [same, own, sectorOthers, [dept]] = await Promise.all([
      active(eq(vacationInstallments.accrualPeriodId, period.id)),
      active(eq(vacationInstallments.employeeId, emp.id)),
      active(and(eq(vacationInstallments.departmentId, departmentId), ne(vacationInstallments.employeeId, emp.id))),
      ex
        .select({ limit: departments.maxSimultaneousVacations })
        .from(departments)
        .where(and(eq(departments.tenantId, emp.tenantId), eq(departments.id, departmentId))),
    ]);
    const blocked = await this.blockedDays(ex, emp, request.start, 3);
    assertVacationRequest({
      request,
      noticeDate: this.today(emp),
      entitlementDays: period.entitledDays,
      sameAcquisitivePeriods: same.map(asPeriod),
      ownApprovedPeriods: own.map(asPeriod),
      sector: { limit: dept!.limit, othersApproved: sectorOthers.map(asPeriod) },
      holidays: blocked.holidays,
      restDays: blocked.restDays,
      companyId: String(emp.companyId),
      parameters: params,
    });
  }

  async request(ctx: RequestContext, employeeId: number, body: z.infer<typeof requestVacationBody>): Promise<VacationDto> {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const [period] = await this.d.db
      .select()
      .from(vacationAccrualPeriods)
      .where(and(eq(vacationAccrualPeriods.tenantId, emp.tenantId), eq(vacationAccrualPeriods.id, body.accrualPeriodId), eq(vacationAccrualPeriods.employeeId, emp.id)))
      .limit(1);
    if (!period) throw new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'accrualPeriodId', message: 'período aquisitivo não encontrado' }]);
    // Setor vigente no início do gozo (copiado para a regra do setor desfalcado)
    const [assignment] = await this.d.db
      .select({ departmentId: employeeAssignments.departmentId })
      .from(employeeAssignments)
      .where(
        and(
          eq(employeeAssignments.tenantId, emp.tenantId),
          eq(employeeAssignments.employeeId, emp.id),
          lte(employeeAssignments.validFrom, body.startDate),
          or(isNull(employeeAssignments.validTo), gte(employeeAssignments.validTo, body.startDate)),
        ),
      )
      .limit(1);
    if (!assignment) throw new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'startDate', message: 'sem vínculo (setor) vigente no início das férias' }]);
    const request = { start: body.startDate, end: body.endDate, cashAllowanceDays: body.cashBonusDays };
    await this.validate(this.d.db, emp, period, assignment.departmentId, request, null);
    const row = await this.d.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(vacationInstallments)
        .values({
          tenantId: emp.tenantId,
          accrualPeriodId: period.id,
          employeeId: emp.id,
          departmentId: assignment.departmentId,
          startDate: body.startDate,
          endDate: body.endDate,
          cashBonusDays: body.cashBonusDays,
          requestedById: ctx.userId,
          requestedAt: this.d.clock.now(),
        })
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'gozos_ferias',
        entityId: created!.id,
        action: 'criacao',
        after: { startDate: body.startDate, endDate: body.endDate, cashBonusDays: body.cashBonusDays },
      });
      return created!;
    });
    return toVacationDto(row, period.grantDeadline);
  }

  async decide(ctx: RequestContext, id: number, decision: 'approve' | 'reject' | 'cancel', reason?: string): Promise<VacationDto> {
    const tenantId = tenantOf(ctx);
    const [current] = await this.d.db
      .select()
      .from(vacationInstallments)
      .where(and(eq(vacationInstallments.tenantId, tenantId), eq(vacationInstallments.id, id)))
      .limit(1);
    if (!current) throw notFound('Férias');
    const emp = await findEmployeeInScope(this.d.db, ctx, current.employeeId).catch(() => {
      throw notFound('Férias');
    });
    const row = await this.d.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(vacationInstallments)
        .where(and(eq(vacationInstallments.tenantId, tenantId), eq(vacationInstallments.id, id)))
        .for('update');
      const allowed = decision === 'cancel' ? ['solicitada', 'aprovada'] : ['solicitada'];
      if (!allowed.includes(locked!.status)) throw new HttpError(409, 'STATUS_INVALIDO', 'As férias não estão num status que permita essa ação');
      const [period] = await tx.select().from(vacationAccrualPeriods).where(and(eq(vacationAccrualPeriods.tenantId, tenantId), eq(vacationAccrualPeriods.id, locked!.accrualPeriodId)));
      if (decision === 'approve') {
        // Contagem atual (o trigger do setor confere de novo, com o setor travado)
        await this.validate(tx, emp, period!, locked!.departmentId, asPeriod(locked!), id);
      }
      const status = decision === 'approve' ? 'aprovada' : decision === 'reject' ? 'recusada' : 'cancelada';
      const [after] = await tx
        .update(vacationInstallments)
        .set({ status, decidedById: ctx.userId, decidedAt: this.d.clock.now(), decisionReason: reason ?? null })
        .where(and(eq(vacationInstallments.tenantId, tenantId), eq(vacationInstallments.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'gozos_ferias',
        entityId: id,
        action: decision === 'approve' ? 'aprovacao' : decision === 'reject' ? 'recusa' : 'alteracao',
        before: { status: locked!.status },
        after: { status },
        reason: reason ?? null,
      });
      return { row: after!, grantDeadline: period!.grantDeadline };
    });
    return toVacationDto(row.row, row.grantDeadline);
  }
}
