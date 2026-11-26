/**
 * Escalas (G2, RF07 a RF12). A escala é do estabelecimento; o colaborador é
 * ligado a ela com vigência (`colaboradores_escalas`, EXCLUDE
 * colab_escala_sem_sobreposicao → 409 ESCALA_SOBREPOSTA).
 *
 * A carga semanal é conferida contra a regra vigente (RN06) e contra a próxima
 * troca de regra (RF11: 44 h → 42 h em 16/12/2026, 40 h em 16/12/2027), só como aviso.
 */
import type { Clock } from '@genus/shared';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import { containsAny } from '../../http/search';
import type { Executor } from '../../db/executor';
import type { ArpPunchReader } from '../../arp/punch-reader';
import { employees, employeeSchedules, establishments, scheduleDays, scheduleOverrides, schedules } from '../../db/schema';
import { establishmentInScope, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope, type EmployeeRecord } from '../employees/lookup';
import { PARAM } from '../legal-parameters/rules/keys';
import { loadLegalParameters } from '../legal-parameters/repository';
import { addDays, type CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import type { DayPostingHook } from '../time-bank/posting-hook';
import { TimesheetService } from '../timesheets/service';
import { checkWeek, resolveWorkweekRule } from '../workweek/rules/weekly-limit';
import { resolveScheduleDay, type ScheduleDayDef, type ScheduleDef } from './rules/day-schedule';
import { planSwitch, type AssignmentRange } from './rules/switch';
import type {
  assignScheduleBody,
  createOverrideBody,
  createScheduleBody,
  employeeScheduleDto,
  listSchedulesQuery,
  overrideDto,
  scheduleDto,
  switchScheduleBody,
  updateScheduleBody,
} from './schemas';

type ScheduleDto = z.infer<typeof scheduleDto>;
type EmployeeScheduleDto = z.infer<typeof employeeScheduleDto>;
type OverrideDto = z.infer<typeof overrideDto>;
type DayInput = z.infer<typeof createScheduleBody>['days'][number];

const hhmm = (t: string | null) => (t === null ? null : t.slice(0, 5));

export async function loadScheduleDays(ex: Executor, tenantId: number, scheduleId: number): Promise<ScheduleDayDef[]> {
  const rows = await ex
    .select()
    .from(scheduleDays)
    .where(and(eq(scheduleDays.tenantId, tenantId), eq(scheduleDays.scheduleId, scheduleId)))
    .orderBy(asc(scheduleDays.position));
  return rows.map((d) => ({
    position: d.position,
    isDayOff: d.isDayOff,
    startTime: hhmm(d.startTime),
    endTime: hhmm(d.endTime),
    breakStartTime: hhmm(d.breakStartTime),
    breakEndTime: hhmm(d.breakEndTime),
    crossesMidnight: d.crossesMidnight,
  }));
}

export interface ScheduleServiceDeps {
  db: Database;
  clock: Clock;
  /** Para recalcular os dias já apurados quando o plano muda. */
  arp: ArpPunchReader;
  posting?: DayPostingHook;
}

export class ScheduleService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: ScheduleServiceDeps) {
    this.timesheets = new TimesheetService(d);
  }

  /** Hoje no fuso do estabelecimento do colaborador. */
  private today(emp: Pick<EmployeeRecord, 'uf'>): CivilDate {
    return toCivilDate(this.d.clock.now(), timezoneForUf(emp.uf));
  }

  /** O plano de [from, to] mudou: recalcula o que já foi apurado, até hoje. Período fechado = 409. */
  private async replan(tx: Executor, emp: EmployeeRecord, from: CivilDate, to: CivilDate | null): Promise<void> {
    const today = this.today(emp);
    const end = to === null || to > today ? today : to;
    await this.timesheets.recalculateExistingIn(tx, emp, from, end);
  }

  private async establishment(ctx: RequestContext, establishmentId: number) {
    const [est] = await this.d.db
      .select({ id: establishments.id, companyId: establishments.companyId, uf: establishments.uf })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantOf(ctx)), eq(establishments.id, establishmentId)))
      .limit(1);
    if (!est || !establishmentInScope(ctx, establishmentId)) return null;
    return est;
  }

  /** Avisos da carga semanal na regra de hoje e nas próximas trocas de regra (RF11). */
  private async warnings(ctx: RequestContext, est: { companyId: number; uf: string }, def: ScheduleDef) {
    const params = await loadLegalParameters(this.d.db, tenantOf(ctx), est.companyId);
    const today = toCivilDate(this.d.clock.now(), timezoneForUf(est.uf));
    const changes = params
      .filter((p) => (p.key === PARAM.weeklyMaxMinutes || p.key === PARAM.weeklyMinRestDays) && p.validFrom > today)
      .map((p) => p.validFrom);
    const dates = [...new Set([today, ...changes])].sort();
    // uma semana da escala: semanal = posições 0 a 6 (22/11/2026 é um domingo, só para numerar);
    // cíclica = 7 dias a partir da referência
    const start: CivilDate = def.cycleType === 'ciclico' ? (def.referenceDate as string) : '2026-11-22';
    const week = Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => ({
      date,
      expectedMinutes: resolveScheduleDay(def, date).plannedMinutes,
    }));
    const out: ScheduleDto['warnings'] = [];
    for (const date of dates) {
      let rule;
      try {
        rule = resolveWorkweekRule(params, date, String(est.companyId));
      } catch {
        continue; // sem parâmetro vigente: sem aviso (o cálculo da apuração é quem exige o parâmetro)
      }
      for (const w of checkWeek(week, rule)) out.push({ ruleValidFrom: date, ...w });
    }
    return out;
  }

  private async dto(ctx: RequestContext, id: number): Promise<ScheduleDto> {
    const tenantId = tenantOf(ctx);
    const [s] = await this.d.db
      .select()
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, id)))
      .limit(1);
    const est = s ? await this.establishment(ctx, s.establishmentId) : null;
    if (!s || !est) throw notFound('Escala');
    const days = await loadScheduleDays(this.d.db, tenantId, id);
    const def: ScheduleDef = { cycleType: s.cycleType as ScheduleDef['cycleType'], cycleDays: s.cycleDays, referenceDate: s.referenceDate, days };
    return {
      id: s.id,
      establishmentId: s.establishmentId,
      name: s.name,
      type: s.type,
      cycleType: s.cycleType,
      cycleDays: s.cycleDays,
      referenceDate: s.referenceDate,
      weeklyMinutes: s.weeklyMinutes,
      isActive: s.isActive,
      days,
      warnings: await this.warnings(ctx, est, def),
    };
  }

  async list(ctx: RequestContext, q: z.infer<typeof listSchedulesQuery>) {
    const tenantId = tenantOf(ctx);
    const rows = await this.d.db
      .select()
      .from(schedules)
      .where(
        and(
          eq(schedules.tenantId, tenantId),
          q.establishmentId ? eq(schedules.establishmentId, q.establishmentId) : undefined,
          q.q ? containsAny([schedules.name], q.q) : undefined,
          q.status ? eq(schedules.isActive, q.status === 'ativa') : undefined,
        ),
      )
      .orderBy(asc(schedules.name));
    return rows.filter((r) => establishmentInScope(ctx, r.establishmentId));
  }

  get(ctx: RequestContext, id: number): Promise<ScheduleDto> {
    return this.dto(ctx, id);
  }

  private dayRows(tenantId: number, scheduleId: number, days: DayInput[]) {
    return days.map((d) => ({
      tenantId,
      scheduleId,
      position: d.position,
      isDayOff: d.isDayOff,
      startTime: d.startTime ?? null,
      endTime: d.endTime ?? null,
      breakStartTime: d.breakStartTime ?? null,
      breakEndTime: d.breakEndTime ?? null,
      crossesMidnight: d.crossesMidnight,
    }));
  }

  async create(ctx: RequestContext, body: z.infer<typeof createScheduleBody>): Promise<ScheduleDto> {
    const tenantId = tenantOf(ctx);
    if (!(await this.establishment(ctx, body.establishmentId))) {
      throw new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'establishmentId', message: 'estabelecimento não encontrado' }]);
    }
    const id = await this.d.db.transaction(async (tx) => {
      const [s] = await tx
        .insert(schedules)
        .values({
          tenantId,
          establishmentId: body.establishmentId,
          name: body.name,
          type: body.type,
          cycleType: body.cycleType,
          cycleDays: body.cycleDays ?? null,
          referenceDate: body.referenceDate ?? null,
          weeklyMinutes: body.weeklyMinutes,
        })
        .returning({ id: schedules.id });
      await tx.insert(scheduleDays).values(this.dayRows(tenantId, s!.id, body.days));
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'escalas', entityId: s!.id, action: 'criacao', after: { name: body.name, type: body.type } });
      return s!.id;
    });
    return this.dto(ctx, id);
  }

  async update(ctx: RequestContext, id: number, body: z.infer<typeof updateScheduleBody>): Promise<ScheduleDto> {
    const tenantId = tenantOf(ctx);
    const before = await this.dto(ctx, id);
    if (body.days) {
      const max = before.cycleType === 'ciclico' ? (before.cycleDays ?? 0) - 1 : 6;
      const positions = body.days.map((d) => d.position);
      if (new Set(positions).size !== positions.length || positions.some((p) => p > max)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'days', message: `posições únicas de 0 a ${max}` }]);
      }
    }
    await this.d.db.transaction(async (tx) => {
      const { days, ...fields } = body;
      if (Object.keys(fields).length > 0) {
        await tx.update(schedules).set(fields).where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, id)));
      }
      if (days) {
        // A apuração já gravada guarda o número calculado; recalcular usa a escala nova [A CONFIRMAR: versionar dias_escala].
        await tx.delete(scheduleDays).where(and(eq(scheduleDays.tenantId, tenantId), eq(scheduleDays.scheduleId, id)));
        await tx.insert(scheduleDays).values(this.dayRows(tenantId, id, days));
      }
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'escalas',
        entityId: id,
        action: 'alteracao',
        before: { name: before.name, weeklyMinutes: before.weeklyMinutes, isActive: before.isActive, days: before.days },
        after: body,
      });
    });
    return this.dto(ctx, id);
  }

  /** Escala da conta, ativa e do estabelecimento do colaborador; senão 400. */
  private async assignableSchedule(tenantId: number, emp: EmployeeRecord, scheduleId: number) {
    const [s] = await this.d.db
      .select({ id: schedules.id, establishmentId: schedules.establishmentId, name: schedules.name, isActive: schedules.isActive })
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, scheduleId)))
      .limit(1);
    if (!s || s.establishmentId !== emp.establishmentId) {
      throw new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'scheduleId', message: 'escala não encontrada no estabelecimento do colaborador' }]);
    }
    if (!s.isActive) throw new HttpError(400, 'ESCALA_INATIVA', 'A escala está inativa: reative-a antes de atribuir');
    return s;
  }

  async assign(ctx: RequestContext, employeeId: number, body: z.infer<typeof assignScheduleBody>): Promise<EmployeeScheduleDto> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const s = await this.assignableSchedule(tenantId, emp, body.scheduleId);
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employeeSchedules)
        .values({ tenantId, employeeId, scheduleId: body.scheduleId, validFrom: body.validFrom, validTo: body.validTo ?? null })
        .returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'colaboradores_escalas', entityId: row!.id, action: 'criacao', after: body });
      await this.replan(tx, emp, body.validFrom, body.validTo ?? null);
      return { id: row!.id, employeeId, scheduleId: row!.scheduleId, scheduleName: s.name, validFrom: row!.validFrom, validTo: row!.validTo };
    });
  }

  /** Encerra (ou reabre) o vínculo. Os dias que saem ou entram na vigência são recalculados. */
  async updateAssignment(ctx: RequestContext, employeeId: number, assignmentId: number, validTo: CivilDate | null): Promise<EmployeeScheduleDto> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const [before] = await this.d.db
      .select()
      .from(employeeSchedules)
      .where(and(eq(employeeSchedules.tenantId, tenantId), eq(employeeSchedules.employeeId, employeeId), eq(employeeSchedules.id, assignmentId)))
      .limit(1);
    if (!before) throw notFound('Vínculo de escala');
    if (validTo !== null && validTo < before.validFrom) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'validTo', message: 'fim antes do início da escala' }]);
    }
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .update(employeeSchedules)
        .set({ validTo })
        .where(and(eq(employeeSchedules.tenantId, tenantId), eq(employeeSchedules.id, assignmentId)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'colaboradores_escalas',
        entityId: assignmentId,
        action: 'alteracao',
        before: { validTo: before.validTo },
        after: { validTo },
      });
      // muda o plano do menor fim em diante (encerrar tira dias; reabrir devolve)
      const ends = [before.validTo, validTo].filter((d): d is string => d !== null).sort();
      const from = ends.length > 0 ? addDays(ends[0]!, 1) : before.validFrom;
      await this.replan(tx, emp, from, null);
      return this.assignmentDto(tx, tenantId, row!);
    });
  }

  /**
   * Troca de escala a partir de `validFrom`, numa transação: encerra o vínculo vigente no dia anterior
   * (ou troca a escala dele, se começa no mesmo dia) e abre o novo até o próximo vínculo, se houver.
   */
  async switchSchedule(ctx: RequestContext, employeeId: number, body: z.infer<typeof switchScheduleBody>): Promise<EmployeeScheduleDto> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const s = await this.assignableSchedule(tenantId, emp, body.scheduleId);
    return this.d.db.transaction(async (tx) => {
      const rows: AssignmentRange[] = await tx
        .select({ id: employeeSchedules.id, scheduleId: employeeSchedules.scheduleId, validFrom: employeeSchedules.validFrom, validTo: employeeSchedules.validTo })
        .from(employeeSchedules)
        .where(and(eq(employeeSchedules.tenantId, tenantId), eq(employeeSchedules.employeeId, employeeId)))
        .orderBy(asc(employeeSchedules.validFrom))
        .for('update');
      const plan = planSwitch(rows, body.validFrom);
      let id: number;
      if (plan.kind === 'replace') {
        await tx
          .update(employeeSchedules)
          .set({ scheduleId: body.scheduleId })
          .where(and(eq(employeeSchedules.tenantId, tenantId), eq(employeeSchedules.id, plan.current.id)));
        id = plan.current.id;
        await recordAudit(tx, this.d.clock, {
          tenantId,
          userId: ctx.userId,
          entity: 'colaboradores_escalas',
          entityId: id,
          action: 'alteracao',
          before: { scheduleId: plan.current.scheduleId },
          after: { scheduleId: body.scheduleId },
        });
      } else {
        if (plan.close) {
          await tx
            .update(employeeSchedules)
            .set({ validTo: plan.close.validTo })
            .where(and(eq(employeeSchedules.tenantId, tenantId), eq(employeeSchedules.id, plan.close.id)));
          await recordAudit(tx, this.d.clock, {
            tenantId,
            userId: ctx.userId,
            entity: 'colaboradores_escalas',
            entityId: plan.close.id,
            action: 'alteracao',
            before: { validTo: plan.close.previousValidTo },
            after: { validTo: plan.close.validTo },
          });
        }
        const [row] = await tx
          .insert(employeeSchedules)
          .values({ tenantId, employeeId, scheduleId: body.scheduleId, validFrom: body.validFrom, validTo: plan.newValidTo })
          .returning({ id: employeeSchedules.id });
        id = row!.id;
        await recordAudit(tx, this.d.clock, {
          tenantId,
          userId: ctx.userId,
          entity: 'colaboradores_escalas',
          entityId: id,
          action: 'criacao',
          after: { scheduleId: body.scheduleId, validFrom: body.validFrom, validTo: plan.newValidTo },
        });
      }
      await this.replan(tx, emp, body.validFrom, plan.kind === 'replace' ? plan.current.validTo : plan.newValidTo);
      const [row] = await tx.select().from(employeeSchedules).where(and(eq(employeeSchedules.tenantId, tenantId), eq(employeeSchedules.id, id)));
      return { ...(await this.assignmentDto(tx, tenantId, row!)), scheduleName: s.name };
    });
  }

  private async assignmentDto(ex: Executor, tenantId: number, r: typeof employeeSchedules.$inferSelect): Promise<EmployeeScheduleDto> {
    const [s] = await ex
      .select({ name: schedules.name })
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, r.scheduleId)))
      .limit(1);
    return { id: r.id, employeeId: r.employeeId, scheduleId: r.scheduleId, scheduleName: s?.name ?? '', validFrom: r.validFrom, validTo: r.validTo };
  }

  async listForEmployee(ctx: RequestContext, employeeId: number): Promise<EmployeeScheduleDto[]> {
    await findEmployeeInScope(this.d.db, ctx, employeeId);
    const rows = await this.d.db
      .select({
        id: employeeSchedules.id,
        employeeId: employeeSchedules.employeeId,
        scheduleId: employeeSchedules.scheduleId,
        scheduleName: schedules.name,
        validFrom: employeeSchedules.validFrom,
        validTo: employeeSchedules.validTo,
      })
      .from(employeeSchedules)
      .innerJoin(schedules, and(eq(schedules.tenantId, employeeSchedules.tenantId), eq(schedules.id, employeeSchedules.scheduleId)))
      .where(and(eq(employeeSchedules.tenantId, tenantOf(ctx)), eq(employeeSchedules.employeeId, employeeId)))
      .orderBy(asc(employeeSchedules.validFrom));
    return rows;
  }

  /** Colaboradores com vínculo na escala na data (padrão: hoje), no escopo de quem pede. */
  async employeesOf(ctx: RequestContext, scheduleId: number, date?: CivilDate) {
    const tenantId = tenantOf(ctx);
    const [s] = await this.d.db
      .select({ establishmentId: schedules.establishmentId, uf: establishments.uf })
      .from(schedules)
      .innerJoin(establishments, and(eq(establishments.tenantId, schedules.tenantId), eq(establishments.id, schedules.establishmentId)))
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, scheduleId)))
      .limit(1);
    if (!s || !establishmentInScope(ctx, s.establishmentId)) throw notFound('Escala');
    const on = date ?? toCivilDate(this.d.clock.now(), timezoneForUf(s.uf));
    return this.d.db
      .select({
        employeeId: employees.id,
        name: employees.name,
        registration: employees.registrationNumber,
        assignmentId: employeeSchedules.id,
        validFrom: employeeSchedules.validFrom,
        validTo: employeeSchedules.validTo,
      })
      .from(employeeSchedules)
      .innerJoin(employees, and(eq(employees.tenantId, employeeSchedules.tenantId), eq(employees.id, employeeSchedules.employeeId)))
      .where(
        and(
          eq(employeeSchedules.tenantId, tenantId),
          eq(employeeSchedules.scheduleId, scheduleId),
          lte(employeeSchedules.validFrom, on),
          or(isNull(employeeSchedules.validTo), gte(employeeSchedules.validTo, on)),
        ),
      )
      .orderBy(asc(employees.name));
  }

  // ------------------------------------------------------------------ troca de turno (RF12)

  private overrideDto(r: typeof scheduleOverrides.$inferSelect): OverrideDto {
    return {
      id: r.id,
      employeeId: r.employeeId,
      date: r.date,
      isDayOff: r.isDayOff,
      startTime: hhmm(r.startTime),
      endTime: hhmm(r.endTime),
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async listOverrides(ctx: RequestContext, employeeId: number, from: CivilDate, to: CivilDate): Promise<OverrideDto[]> {
    await findEmployeeInScope(this.d.db, ctx, employeeId);
    const rows = await this.d.db
      .select()
      .from(scheduleOverrides)
      .where(and(eq(scheduleOverrides.tenantId, tenantOf(ctx)), eq(scheduleOverrides.employeeId, employeeId), gte(scheduleOverrides.date, from), lte(scheduleOverrides.date, to)))
      .orderBy(desc(scheduleOverrides.date));
    return rows.map((r) => this.overrideDto(r));
  }

  /** Uma troca por dia (UNIQUE troca_unica → 409). Muda só o previsto; a marcação original não muda. */
  async createOverride(ctx: RequestContext, employeeId: number, body: z.infer<typeof createOverrideBody>): Promise<OverrideDto> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    if (ctx.userId === null) throw new HttpError(403, 'FORBIDDEN', 'Você não tem permissão para esta ação');
    const userId = ctx.userId;
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(scheduleOverrides)
        .values({
          tenantId,
          employeeId,
          date: body.date,
          isDayOff: body.isDayOff,
          startTime: body.isDayOff ? null : (body.startTime ?? null),
          endTime: body.isDayOff ? null : (body.endTime ?? null),
          reason: body.reason,
          createdById: userId,
        })
        .returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId, entity: 'trocas_turno', entityId: row!.id, action: 'criacao', after: body });
      await this.replan(tx, emp, body.date, body.date);
      return this.overrideDto(row!);
    });
  }

  async deleteOverride(ctx: RequestContext, employeeId: number, overrideId: number): Promise<void> {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    await this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .delete(scheduleOverrides)
        .where(and(eq(scheduleOverrides.tenantId, tenantId), eq(scheduleOverrides.employeeId, employeeId), eq(scheduleOverrides.id, overrideId)))
        .returning();
      if (!row) throw notFound('Troca de turno');
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'trocas_turno',
        entityId: overrideId,
        action: 'exclusao',
        before: { date: row.date, isDayOff: row.isDayOff, startTime: row.startTime, endTime: row.endTime, reason: row.reason },
      });
      await this.replan(tx, emp, row.date, row.date);
    });
  }
}

