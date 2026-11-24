/**
 * Afastamento (G7, RF29 a RF31). Sem sobreposição para o mesmo colaborador
 * (EXCLUDE afast_sem_sobreposicao → 409 AFASTAMENTO_SOBREPOSTO). O afastamento
 * muda a apuração: os dias já apurados do intervalo são recalculados na mesma
 * transação. Período fechado: 409 PERIODO_FECHADO (a tabela não tem trigger; a
 * api confere com rh.fn_periodo_fechado).
 */
import type { Clock } from '@genus/shared';
import { and, asc, between, eq, max, min } from 'drizzle-orm';
import type { z } from 'zod';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import type { Executor } from '../../db/executor';
import { absences, dailyTimesheets } from '../../db/schema';
import { tenantOf } from '../../http/access';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { assertPeriodOpen } from '../closing/period-lock';
import { findEmployeeInScope, type EmployeeRecord } from '../employees/lookup';
import type { CivilDate } from '../rules-common/rules/civil-time';
import { TimesheetService } from '../timesheets/service';
import type { absenceDto, createAbsenceBody } from './schemas';

type AbsenceDto = z.infer<typeof absenceDto>;

export interface AbsenceServiceDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
}

export class AbsenceService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: AbsenceServiceDeps) {
    this.timesheets = new TimesheetService(d);
  }

  /** Recalcula só os dias do intervalo que já têm apuração. */
  async recalculateExisting(tx: Executor, emp: EmployeeRecord, from: CivilDate, to: CivilDate): Promise<void> {
    const [range] = await tx
      .select({ first: min(dailyTimesheets.date), last: max(dailyTimesheets.date) })
      .from(dailyTimesheets)
      .where(and(eq(dailyTimesheets.tenantId, emp.tenantId), eq(dailyTimesheets.employeeId, emp.id), between(dailyTimesheets.date, from, to)));
    if (range?.first && range.last) await this.timesheets.recalculateIn(tx, emp, range.first, range.last);
  }

  /** Grava o afastamento (manual ou do atestado aprovado) dentro da transação de quem chama. */
  async insert(
    tx: Executor,
    ctx: RequestContext,
    emp: EmployeeRecord,
    a: { type: string; startDate: CivilDate; endDate: CivilDate; certificateId?: number | null },
  ): Promise<AbsenceDto> {
    await assertPeriodOpen(tx, emp.id, a.startDate, a.endDate);
    const [row] = await tx
      .insert(absences)
      .values({ tenantId: emp.tenantId, employeeId: emp.id, type: a.type, startDate: a.startDate, endDate: a.endDate, certificateId: a.certificateId ?? null })
      .returning();
    await recordAudit(tx, this.d.clock, {
      tenantId: emp.tenantId,
      userId: ctx.userId,
      entity: 'afastamentos',
      entityId: row!.id,
      action: 'criacao',
      after: { type: a.type, startDate: a.startDate, endDate: a.endDate },
    });
    await this.recalculateExisting(tx, emp, a.startDate, a.endDate);
    return { id: row!.id, employeeId: emp.id, type: row!.type, startDate: row!.startDate, endDate: row!.endDate, certificateId: row!.certificateId };
  }

  async create(ctx: RequestContext, employeeId: number, body: z.infer<typeof createAbsenceBody>): Promise<AbsenceDto> {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    return this.d.db.transaction((tx) => this.insert(tx, ctx, emp, body));
  }

  async list(ctx: RequestContext, employeeId: number): Promise<AbsenceDto[]> {
    await findEmployeeInScope(this.d.db, ctx, employeeId);
    const rows = await this.d.db
      .select()
      .from(absences)
      .where(and(eq(absences.tenantId, tenantOf(ctx)), eq(absences.employeeId, employeeId)))
      .orderBy(asc(absences.startDate));
    return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, type: r.type, startDate: r.startDate, endDate: r.endDate, certificateId: r.certificateId }));
  }
}
