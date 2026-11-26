/**
 * Dia de um estabelecimento: a lista de apurações de todos (com as contagens das
 * abas) e o "Recalcular dia". Escopo da sessão: conta, estabelecimentos do
 * usuário e equipe do gestor; fora do escopo é 404.
 */
import { and, asc, eq, exists, gte, inArray, isNull, lte, not, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { dailyTimesheets, departments, employeeAssignments, employees, establishments, jobTitles, timesheetIssues } from '../../db/schema';
import { employeeScopeConditions, establishmentInScope, notFound, tenantOf } from '../../http/access';
import { containsAny } from '../../http/search';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { listEmployeeRecords } from './employee-records';
import { BLOCKING_ISSUE_TYPES } from './issue-codes';
import type { dayRowsQuery, dayRowsResponse, recalculateEstablishmentBody, recalculateEstablishmentResponse } from './schemas';
import { loadDayDetails, TimesheetService, type TimesheetServiceDeps } from './service';

type DayRowsQuery = z.infer<typeof dayRowsQuery>;
type DayRowsPage = z.infer<typeof dayRowsResponse>;
type RecalculateBody = z.infer<typeof recalculateEstablishmentBody>;
type RecalculateData = z.infer<typeof recalculateEstablishmentResponse>['data'];

export class EstablishmentDayService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: TimesheetServiceDeps) {
    this.timesheets = new TimesheetService(d);
  }

  private async assertEstablishment(ctx: RequestContext, establishmentId: number): Promise<void> {
    const [row] = await this.d.db
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantOf(ctx)), eq(establishments.id, establishmentId)))
      .limit(1);
    if (!row || !establishmentInScope(ctx, row.id)) throw notFound('Estabelecimento');
  }

  async list(ctx: RequestContext, q: DayRowsQuery): Promise<DayRowsPage> {
    const tenantId = tenantOf(ctx);
    await this.assertEstablishment(ctx, q.establishmentId);
    const db = this.d.db;

    const inconsistent = exists(
      db
        .select({ one: sql`1` })
        .from(timesheetIssues)
        .where(
          and(
            eq(timesheetIssues.tenantId, dailyTimesheets.tenantId),
            eq(timesheetIssues.dailyTimesheetId, dailyTimesheets.id),
            eq(timesheetIssues.isResolved, false),
            inArray(timesheetIssues.type, [...BLOCKING_ISSUE_TYPES]),
          ),
        ),
    );
    const absent = eq(dailyTimesheets.situation, 'falta');
    const byStatus = { inconsistente: inconsistent, falta: absent, calculada: and(not(inconsistent), not(absent)) as SQL };

    // Setor e cargo do vínculo vigente no dia (sem sobreposição no banco: uma linha por colaborador).
    const assignment = and(
      eq(employeeAssignments.tenantId, employees.tenantId),
      eq(employeeAssignments.employeeId, employees.id),
      lte(employeeAssignments.validFrom, q.date),
      or(isNull(employeeAssignments.validTo), gte(employeeAssignments.validTo, q.date)),
    );
    const filters = and(
      ...employeeScopeConditions(ctx),
      eq(dailyTimesheets.tenantId, tenantId),
      eq(dailyTimesheets.date, q.date),
      eq(employees.establishmentId, q.establishmentId),
      q.departmentId ? eq(employeeAssignments.departmentId, q.departmentId) : undefined,
      q.q ? containsAny([employees.name, employees.registrationNumber], q.q) : undefined,
    ) as SQL;
    const ofEmployee = and(eq(employees.tenantId, dailyTimesheets.tenantId), eq(employees.id, dailyTimesheets.employeeId));

    const countWhere = (condition: SQL) => sql<number>`(count(*) FILTER (WHERE ${condition}))::int`;
    const [totals] = await db
      .select({
        todos: sql<number>`count(*)::int`,
        inconsistente: countWhere(byStatus.inconsistente),
        falta: countWhere(byStatus.falta),
        calculada: countWhere(byStatus.calculada),
      })
      .from(dailyTimesheets)
      .innerJoin(employees, ofEmployee)
      .leftJoin(employeeAssignments, assignment)
      .where(filters);
    const counts = totals ?? { todos: 0, inconsistente: 0, falta: 0, calculada: 0 };

    const rows = await db
      .select({ day: dailyTimesheets, employeeName: employees.name, registrationNumber: employees.registrationNumber, departmentName: departments.name, jobTitleName: jobTitles.name })
      .from(dailyTimesheets)
      .innerJoin(employees, ofEmployee)
      .leftJoin(employeeAssignments, assignment)
      .leftJoin(departments, and(eq(departments.tenantId, employeeAssignments.tenantId), eq(departments.id, employeeAssignments.departmentId)))
      .leftJoin(jobTitles, and(eq(jobTitles.tenantId, employeeAssignments.tenantId), eq(jobTitles.id, employeeAssignments.jobTitleId)))
      .where(and(filters, q.status ? byStatus[q.status] : undefined))
      .orderBy(asc(employees.name), asc(employees.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);

    const details = await loadDayDetails(db, tenantId, rows.map((r) => r.day.id));
    return {
      data: rows.map(({ day, ...person }) => ({
        ...person,
        ...details(day.id),
        employeeId: day.employeeId,
        date: day.date,
        situation: day.situation,
        isAbsence: day.situation === 'falta',
        expectedMinutes: day.expectedMinutes,
        workedMinutes: day.workedMinutes,
        overtimeMinutes: day.overtime50Minutes + day.overtime100Minutes,
        absenceMinutes: day.absenceMinutes,
      })),
      meta: { page: q.page, pageSize: q.pageSize, total: q.status ? counts[q.status] : counts.todos },
      counts,
    };
  }

  /** Um colaborador por transação: um período fechado ou sem escala não segura os demais. */
  async recalculate(ctx: RequestContext, body: RecalculateBody): Promise<RecalculateData> {
    const tenantId = tenantOf(ctx);
    await this.assertEstablishment(ctx, body.establishmentId);
    const team = await listEmployeeRecords(this.d.db, [
      ...employeeScopeConditions(ctx),
      eq(employees.establishmentId, body.establishmentId),
      lte(employees.admissionDate, body.date),
      or(isNull(employees.terminationDate), gte(employees.terminationDate, body.date)) as SQL,
    ]);

    const result: RecalculateData = { recalculated: 0, skipped: [] };
    for (const emp of team) {
      const outcome = await this.timesheets.recalculateDay(emp, body.date);
      if (outcome === 'recalculado') result.recalculated += 1;
      else result.skipped.push({ employeeId: emp.id, reason: outcome });
    }
    await recordAudit(this.d.db, this.d.clock, {
      tenantId,
      userId: ctx.userId,
      entity: 'estabelecimentos',
      entityId: body.establishmentId,
      action: 'alteracao',
      after: { recalculatedDate: body.date, recalculated: result.recalculated, skipped: result.skipped.length },
    });
    return result;
  }
}
