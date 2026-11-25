/**
 * Escalas (G2, RF07 a RF12). A escala é do estabelecimento; o colaborador é
 * ligado a ela com vigência (`colaboradores_escalas`, EXCLUDE
 * colab_escala_sem_sobreposicao → 409 ESCALA_SOBREPOSTA).
 *
 * A carga semanal é conferida contra a regra vigente (RN06) e contra a próxima
 * troca de regra (RF11: 44 h → 42 h em 16/12/2026, 40 h em 16/12/2027), só como aviso.
 */
import type { Clock } from '@genus/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import { containsAny } from '../../http/search';
import type { Executor } from '../../db/executor';
import { employeeSchedules, establishments, scheduleDays, schedules } from '../../db/schema';
import { establishmentInScope, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope } from '../employees/lookup';
import { PARAM } from '../legal-parameters/rules/keys';
import { loadLegalParameters } from '../legal-parameters/repository';
import { addDays, type CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import { checkWeek, resolveWorkweekRule } from '../workweek/rules/weekly-limit';
import { resolveScheduleDay, type ScheduleDayDef, type ScheduleDef } from './rules/day-schedule';
import type { assignScheduleBody, createScheduleBody, listSchedulesQuery, scheduleDto, updateScheduleBody } from './schemas';

type ScheduleDto = z.infer<typeof scheduleDto>;
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
}

export class ScheduleService {
  constructor(private readonly d: ScheduleServiceDeps) {}

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
        before: { name: before.name, weeklyMinutes: before.weeklyMinutes, days: before.days },
        after: body,
      });
    });
    return this.dto(ctx, id);
  }

  async assign(ctx: RequestContext, employeeId: number, body: z.infer<typeof assignScheduleBody>) {
    const tenantId = tenantOf(ctx);
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const [s] = await this.d.db
      .select({ id: schedules.id, establishmentId: schedules.establishmentId })
      .from(schedules)
      .where(and(eq(schedules.tenantId, tenantId), eq(schedules.id, body.scheduleId)))
      .limit(1);
    if (!s || s.establishmentId !== emp.establishmentId) {
      throw new HttpError(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'scheduleId', message: 'escala não encontrada no estabelecimento do colaborador' }]);
    }
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(employeeSchedules)
        .values({ tenantId, employeeId, scheduleId: body.scheduleId, validFrom: body.validFrom, validTo: body.validTo ?? null })
        .returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'colaboradores_escalas', entityId: row!.id, action: 'criacao', after: body });
      return { id: row!.id, employeeId, scheduleId: row!.scheduleId, validFrom: row!.validFrom, validTo: row!.validTo };
    });
  }

  async listForEmployee(ctx: RequestContext, employeeId: number) {
    await findEmployeeInScope(this.d.db, ctx, employeeId);
    const rows = await this.d.db
      .select()
      .from(employeeSchedules)
      .where(and(eq(employeeSchedules.tenantId, tenantOf(ctx)), eq(employeeSchedules.employeeId, employeeId)))
      .orderBy(asc(employeeSchedules.validFrom));
    return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, scheduleId: r.scheduleId, validFrom: r.validFrom, validTo: r.validTo }));
  }
}
