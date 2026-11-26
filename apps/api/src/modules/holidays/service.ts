/**
 * Feriados (G3, RF14 a RF16). Catálogo oficial (conta_id NULL, carregado pela
 * migration 0021) mais os feriados da própria conta. O estabelecimento diz se
 * trabalha no feriado e como trata a hora (`estabelecimentos_feriados`).
 *
 * Mudou o feriado de um dia: os dias já apurados nessa data, nos estabelecimentos
 * atingidos, são recalculados na mesma transação (período fechado → 409).
 */
import type { Clock } from '@genus/shared';
import { and, asc, between, eq, isNull, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import type { Executor } from '../../db/executor';
import { employees, establishmentHolidays, establishments, holidays } from '../../db/schema';
import { establishmentInScope, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import type { CivilDate } from '../rules-common/rules/civil-time';
import type { DayPostingHook } from '../time-bank/posting-hook';
import { listEmployeeRecords } from '../timesheets/employee-records';
import { TimesheetService } from '../timesheets/service';
import type { createHolidayBody, HolidayDto, setEstablishmentHolidayBody, updateHolidayBody } from './schemas';

export interface HolidayServiceDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
  posting?: DayPostingHook;
}

type HolidayRow = typeof holidays.$inferSelect;
type Est = { id: number; uf: string; municipalityIbge: string };

export class HolidayService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: HolidayServiceDeps) {
    this.timesheets = new TimesheetService(d);
  }

  private async establishment(ctx: RequestContext, establishmentId: number): Promise<Est> {
    const [est] = await this.d.db
      .select({ id: establishments.id, uf: establishments.uf, municipalityIbge: establishments.municipalityIbge })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantOf(ctx)), eq(establishments.id, establishmentId)))
      .limit(1);
    if (!est || !establishmentInScope(ctx, est.id)) throw notFound('Estabelecimento');
    return est;
  }

  /** Feriados que valem no estabelecimento: nacional, da UF, do município; oficiais e da conta. */
  private appliesTo(tenantId: number, est: Est): SQL {
    return and(
      or(isNull(holidays.tenantId), eq(holidays.tenantId, tenantId)),
      or(
        eq(holidays.scope, 'nacional'),
        and(eq(holidays.scope, 'estadual'), eq(holidays.uf, est.uf)),
        and(eq(holidays.scope, 'municipal'), eq(holidays.municipalityIbge, est.municipalityIbge)),
      ),
    )!;
  }

  private dto(h: HolidayRow, link: { isWorked: boolean; treatment: string | null } | undefined): HolidayDto {
    return {
      id: h.id,
      date: h.date,
      name: h.name,
      scope: h.scope as HolidayDto['scope'],
      uf: h.uf,
      municipalityIbge: h.municipalityIbge,
      isOptional: h.isOptional,
      isOwn: h.tenantId !== null,
      isWorked: link?.isWorked ?? false,
      treatment: (link?.treatment as HolidayDto['treatment']) ?? null,
    };
  }

  async list(ctx: RequestContext, establishmentId: number, year: number): Promise<HolidayDto[]> {
    const tenantId = tenantOf(ctx);
    const est = await this.establishment(ctx, establishmentId);
    const rows = await this.d.db
      .select({ h: holidays, isWorked: establishmentHolidays.isWorked, treatment: establishmentHolidays.treatment })
      .from(holidays)
      .leftJoin(
        establishmentHolidays,
        and(eq(establishmentHolidays.holidayId, holidays.id), eq(establishmentHolidays.establishmentId, est.id), eq(establishmentHolidays.tenantId, tenantId)),
      )
      .where(and(between(holidays.date, `${year}-01-01`, `${year}-12-31`), this.appliesTo(tenantId, est)))
      .orderBy(asc(holidays.date), asc(holidays.id));
    return rows.map((r) => this.dto(r.h, r.isWorked === null ? undefined : { isWorked: r.isWorked, treatment: r.treatment }));
  }

  private async findOwn(tenantId: number, id: number): Promise<HolidayRow> {
    const [h] = await this.d.db
      .select()
      .from(holidays)
      .where(and(eq(holidays.id, id), eq(holidays.tenantId, tenantId)))
      .limit(1);
    if (!h) throw notFound('Feriado');
    return h;
  }

  /** Recalcula, nas datas, os dias já apurados dos colaboradores dos estabelecimentos atingidos. */
  private async replan(tx: Executor, tenantId: number, holiday: Pick<HolidayRow, 'scope' | 'uf' | 'municipalityIbge'>, dates: CivilDate[], onlyEstablishment?: number) {
    const conds: SQL[] = [eq(employees.tenantId, tenantId)];
    if (onlyEstablishment !== undefined) conds.push(eq(employees.establishmentId, onlyEstablishment));
    else if (holiday.scope === 'estadual') conds.push(eq(establishments.uf, holiday.uf!));
    else if (holiday.scope === 'municipal') conds.push(eq(establishments.municipalityIbge, holiday.municipalityIbge!));
    const emps = await listEmployeeRecords(tx, conds);
    for (const emp of emps) {
      for (const date of [...new Set(dates)]) await this.timesheets.recalculateExistingIn(tx, emp, date, date);
    }
  }

  async create(ctx: RequestContext, body: z.infer<typeof createHolidayBody>): Promise<HolidayDto> {
    const tenantId = tenantOf(ctx);
    const est = await this.establishment(ctx, body.establishmentId);
    const where = {
      uf: body.scope === 'nacional' ? null : est.uf,
      municipalityIbge: body.scope === 'municipal' ? est.municipalityIbge : null,
    };
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(holidays)
        .values({ tenantId, scope: body.scope, ...where, date: body.date, name: body.name, isOptional: body.isOptional })
        .returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'feriados', entityId: row!.id, action: 'criacao', after: { ...body } });
      if (!row!.isOptional) await this.replan(tx, tenantId, row!, [row!.date]);
      return this.dto(row!, undefined);
    });
  }

  async update(ctx: RequestContext, id: number, body: z.infer<typeof updateHolidayBody>): Promise<HolidayDto> {
    const tenantId = tenantOf(ctx);
    const before = await this.findOwn(tenantId, id);
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .update(holidays)
        .set(body)
        .where(and(eq(holidays.id, id), eq(holidays.tenantId, tenantId)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'feriados',
        entityId: id,
        action: 'alteracao',
        before: { date: before.date, name: before.name, isOptional: before.isOptional },
        after: body,
      });
      await this.replan(tx, tenantId, row!, [before.date, row!.date]);
      return this.dto(row!, undefined);
    });
  }

  /** Só feriado da conta. Remove também a configuração dos estabelecimentos. */
  async remove(ctx: RequestContext, id: number): Promise<void> {
    const tenantId = tenantOf(ctx);
    const before = await this.findOwn(tenantId, id);
    await this.d.db.transaction(async (tx) => {
      await tx.delete(establishmentHolidays).where(and(eq(establishmentHolidays.tenantId, tenantId), eq(establishmentHolidays.holidayId, id)));
      await tx.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.tenantId, tenantId)));
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'feriados',
        entityId: id,
        action: 'exclusao',
        before: { date: before.date, name: before.name, scope: before.scope },
      });
      await this.replan(tx, tenantId, before, [before.date]);
    });
  }

  /** RF16: trabalha no feriado e como trata a hora, por estabelecimento. */
  async setForEstablishment(
    ctx: RequestContext,
    establishmentId: number,
    holidayId: number,
    body: z.infer<typeof setEstablishmentHolidayBody>,
  ): Promise<HolidayDto> {
    const tenantId = tenantOf(ctx);
    const est = await this.establishment(ctx, establishmentId);
    const [h] = await this.d.db
      .select()
      .from(holidays)
      .where(and(eq(holidays.id, holidayId), this.appliesTo(tenantId, est)))
      .limit(1);
    if (!h) throw notFound('Feriado');
    if (h.isOptional && body.isWorked) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'isWorked', message: 'feriado facultativo não muda a apuração' }]);
    }
    const treatment = body.isWorked ? (body.treatment ?? null) : null;
    return this.d.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(establishmentHolidays)
        .where(and(eq(establishmentHolidays.tenantId, tenantId), eq(establishmentHolidays.establishmentId, est.id), eq(establishmentHolidays.holidayId, h.id)));
      await tx
        .insert(establishmentHolidays)
        .values({ tenantId, establishmentId: est.id, holidayId: h.id, isWorked: body.isWorked, treatment })
        .onConflictDoUpdate({ target: [establishmentHolidays.establishmentId, establishmentHolidays.holidayId], set: { isWorked: body.isWorked, treatment } });
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'estabelecimentos_feriados',
        entityId: h.id,
        action: before ? 'alteracao' : 'criacao',
        before: before ? { establishmentId: est.id, isWorked: before.isWorked, treatment: before.treatment } : null,
        after: { establishmentId: est.id, isWorked: body.isWorked, treatment },
      });
      await this.replan(tx, tenantId, h, [h.date], est.id);
      return this.dto(h, { isWorked: body.isWorked, treatment });
    });
  }
}
