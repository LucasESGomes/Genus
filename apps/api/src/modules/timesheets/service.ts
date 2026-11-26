/**
 * Apuração do dia (G4, RF17 a RF22) contra o banco: lê as batidas do arp (só
 * leitura), a escala, a troca de turno, o feriado, as férias e afastamentos, os
 * ajustes aprovados e os parâmetros legais; chama `computeDay` (regra pura,
 * timesheets/rules/day.ts) e grava `apuracoes_dia`, `apuracoes_marcacoes` e
 * `inconsistencias`.
 *
 * - Nunca altera a marcação original (RN01): guarda só o NSR.
 * - Recalcular o mesmo dia com os mesmos dados dá o mesmo resultado (RNF05):
 *   nada aqui lê o relógio para calcular; o relógio só carimba `calculado_em`.
 * - Batida ímpar ou duplicada vira inconsistência, com o dia sem minutos
 *   calculados; nunca cálculo silencioso.
 * - Período fechado: 409 PERIODO_FECHADO, para o intervalo inteiro.
 * - Dia aberto (janela ainda não encerrada) não acusa falta, atraso nem batida
 *   faltando (rules/open-day.ts); o banco de horas só lança no dia encerrado.
 * - Um recálculo por colaborador de cada vez (lock de transação): fila, recálculo
 *   manual, ajuste e afastamento passam por `recalculateIn`.
 *
 * A janela de cada dia (inclusive a escala que vira o dia) está em schedule-window.ts.
 */
import type { Clock } from '@genus/shared';
import { and, asc, between, eq, gte, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import type { Executor } from '../../db/executor';
import {
  absences,
  dailyTimesheets,
  establishmentHolidays,
  holidays,
  timeAdjustments,
  timesheetIssues,
  timesheetPunches,
  vacationInstallments,
} from '../../db/schema';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { closedDates, periodClosed } from '../closing/period-lock';
import { findEmployeeInScope, type EmployeeRecord } from '../employees/lookup';
import { loadLegalParameters } from '../legal-parameters/repository';
import { ParameterReader, type LegalParameterRow } from '../legal-parameters/rules/resolve';
import { addDays, diffDays, type CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toLocalDateTime } from '../rules-common/rules/timezone';
import type { DayPostingHook } from '../time-bank/posting-hook';
import { BLOCKING_ISSUE_TYPES, toIssueTypes, type IssueType } from './issue-codes';
import { computeDay, type DayResult, type HolidayTreatment, type Punch } from './rules/day';
import type { NightWorkType } from './rules/night';
import { asOpenDay } from './rules/open-day';
import { dayEndsAt, loadScheduleResolver } from './schedule-window';

/** Chave do tipo de trabalho noturno da empresa (RN07). Sem linha: urbano [A CONFIRMAR]. */
const NIGHT_TYPE_KEY = 'tipo_trabalho_noturno';
const NIGHT_TYPES: readonly NightWorkType[] = ['urbano', 'rural_lavoura', 'rural_pecuaria'];
export const MAX_RECALC_DAYS = 62;

/** Sem cálculo possível: o dia fica como estava. */
export interface SkippedDay {
  date: CivilDate;
  reason: 'sem_escala';
}

/** Resultado do recálculo de um dia fora de uma requisição por colaborador (fila e dia do estabelecimento). */
export type DayRecalculationOutcome = 'recalculado' | 'sem_escala' | 'periodo_fechado';

export interface TimesheetDayDto {
  date: string;
  situation: string;
  /** `inconsistente` = batida ímpar ou duplicada pendente: os minutos não foram calculados. */
  status: 'calculada' | 'inconsistente';
  scheduleId: number | null;
  expectedMinutes: number;
  workedMinutes: number;
  absenceMinutes: number;
  lateMinutes: number;
  overtime50Minutes: number;
  overtime100Minutes: number;
  nightMinutes: number;
  breakMinutes: number;
  parameterVersion: string;
  calculatedAt: string;
  punches: { sequence: number; at: string; origin: 'original' | 'tratada'; nsr: number | null; adjustmentId: number | null }[];
  issues: { type: IssueType; resolved: boolean }[];
}

interface PlacedPunch {
  punch: Punch;
  instant: Date;
  adjustmentId: number | null;
}

interface ComputedDay {
  date: CivilDate;
  /** Fim da janela do dia: a partir dele o dia está encerrado. */
  endsAt: Date;
  scheduleId: number;
  result: DayResult;
  punches: PlacedPunch[];
}

export interface TimesheetServiceDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
  /** Lançamento no banco de horas, na mesma transação do dia. Ausente = nada é lançado. */
  posting?: DayPostingHook;
}

export class TimesheetService {
  constructor(private readonly d: TimesheetServiceDeps) {}

  async recalculate(ctx: RequestContext, employeeId: number, from: CivilDate, to: CivilDate) {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    assertRange(from, to, MAX_RECALC_DAYS);
    const skipped = await this.d.db.transaction((tx) => this.recalculateIn(tx, emp, from, to));
    return { days: await this.listFor(this.d.db, emp.tenantId, employeeId, from, to), skipped };
  }

  /** Recalcula dentro da transação de quem chama (ex.: aprovação de ajuste). */
  async recalculateIn(tx: Executor, emp: EmployeeRecord, from: CivilDate, to: CivilDate): Promise<SkippedDay[]> {
    // Vale até o fim da transação: dois recálculos do mesmo colaborador não lançam em dobro no banco de horas.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`rh.apuracao:${emp.tenantId}:${emp.id}`}, 0))`);
    if ((await closedDates(tx, emp.id, from, to)).length > 0) throw periodClosed();
    // Um só instante decide se o dia está encerrado e carimba `calculado_em` (o `close-days` compara os dois).
    const now = this.d.clock.now();
    const { computed, skipped } = await this.compute(tx, emp, from, to);
    for (const day of computed) {
      const isClosed = now.getTime() >= day.endsAt.getTime();
      const result = isClosed ? day.result : asOpenDay(day.result);
      const dailyTimesheetId = await this.persist(tx, emp, { ...day, result }, now);
      await this.d.posting?.apply(tx, emp, { dailyTimesheetId, date: day.date, result, isClosed });
    }
    return skipped;
  }

  /**
   * Um dia em transação própria, sem checar escopo (quem chama já checou, ou é a fila).
   * Período fechado e falta de escala não são erro: o dia fica como estava.
   */
  async recalculateDay(emp: EmployeeRecord, date: CivilDate): Promise<DayRecalculationOutcome> {
    try {
      const skipped = await this.d.db.transaction((tx) => this.recalculateIn(tx, emp, date, date));
      return skipped.length > 0 ? 'sem_escala' : 'recalculado';
    } catch (err) {
      if (err instanceof HttpError && err.code === 'PERIODO_FECHADO') return 'periodo_fechado';
      throw err;
    }
  }

  async list(ctx: RequestContext, employeeId: number, from: CivilDate, to: CivilDate): Promise<TimesheetDayDto[]> {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    assertRange(from, to, 93);
    return this.listFor(this.d.db, emp.tenantId, employeeId, from, to);
  }

  async listFor(ex: Executor, tenantId: number, employeeId: number, from: CivilDate, to: CivilDate): Promise<TimesheetDayDto[]> {
    const days = await ex
      .select()
      .from(dailyTimesheets)
      .where(and(eq(dailyTimesheets.tenantId, tenantId), eq(dailyTimesheets.employeeId, employeeId), between(dailyTimesheets.date, from, to)))
      .orderBy(asc(dailyTimesheets.date));
    const details = await loadDayDetails(ex, tenantId, days.map((d) => d.id));
    return days.map((d) => {
      const { punches, issues, status } = details(d.id);
      return {
        date: d.date,
        situation: d.situation,
        status,
        scheduleId: d.scheduleId,
        expectedMinutes: d.expectedMinutes,
        workedMinutes: d.workedMinutes,
        absenceMinutes: d.absenceMinutes,
        lateMinutes: d.lateMinutes,
        overtime50Minutes: d.overtime50Minutes,
        overtime100Minutes: d.overtime100Minutes,
        nightMinutes: d.nightMinutes,
        breakMinutes: d.breakMinutes,
        parameterVersion: d.parameterVersion,
        calculatedAt: d.calculatedAt.toISOString(),
        punches,
        issues,
      };
    });
  }

  // ------------------------------------------------------------------ leitura das entradas

  private async compute(ex: Executor, emp: EmployeeRecord, from: CivilDate, to: CivilDate) {
    const tz = timezoneForUf(emp.uf);
    const first = addDays(from, -2);
    const lastPlus = addDays(to, 1);

    const resolve = await loadScheduleResolver(ex, emp.tenantId, [emp.id], first, lastPlus);
    const scheduleFor = (date: CivilDate) => resolve(emp.id, date);

    // Janela de cada dia em instantes: [fim do dia anterior, fim do dia).
    const endOf = new Map<CivilDate, Date>();
    for (let date = first; date <= to; date = addDays(date, 1)) endOf.set(date, dayEndsAt(date, scheduleFor(date), tz));
    const windowStart = (date: CivilDate) => endOf.get(addDays(date, -1)) as Date;

    const arpPunches = await this.d.arp.listPunches({ tenantId: emp.tenantId, cpf: emp.cpf, from: windowStart(addDays(from, -1)), to: endOf.get(to) as Date });
    const adjustments = await ex
      .select({ id: timeAdjustments.id, date: timeAdjustments.date, proposedAt: timeAdjustments.proposedAt })
      .from(timeAdjustments)
      .where(
        and(
          eq(timeAdjustments.tenantId, emp.tenantId),
          eq(timeAdjustments.employeeId, emp.id),
          eq(timeAdjustments.status, 'aprovado'),
          eq(timeAdjustments.type, 'inclusao_batida'),
          between(timeAdjustments.date, addDays(from, -1), to),
        ),
      );

    const punchesOf = (date: CivilDate): PlacedPunch[] => {
      const start = windowStart(date).getTime();
      const end = (endOf.get(date) as Date).getTime();
      const originals: PlacedPunch[] = arpPunches
        .filter((p) => p.markedAt.getTime() >= start && p.markedAt.getTime() < end)
        .map((p) => ({
          punch: { at: toLocalDateTime(p.markedAt, tz), origin: 'original', nsr: p.nsr, collectedOffline: p.offline },
          instant: p.markedAt,
          adjustmentId: null,
        }));
      const treated: PlacedPunch[] = adjustments
        .filter((a) => a.date === date && a.proposedAt !== null)
        .map((a) => ({ punch: { at: toLocalDateTime(a.proposedAt as Date, tz), origin: 'tratada', nsr: null }, instant: a.proposedAt as Date, adjustmentId: a.id }));
      return [...originals, ...treated].sort((x, y) => x.instant.getTime() - y.instant.getTime() || (x.punch.nsr ?? 0) - (y.punch.nsr ?? 0));
    };

    const [holidayRows, vacationRows, absenceRows, parameters] = await Promise.all([
      this.holidays(ex, emp, from, to),
      ex
        .select({ start: vacationInstallments.startDate, end: vacationInstallments.endDate })
        .from(vacationInstallments)
        .where(
          and(
            eq(vacationInstallments.tenantId, emp.tenantId),
            eq(vacationInstallments.employeeId, emp.id),
            inArray(vacationInstallments.status, ['aprovada', 'gozada']),
            lte(vacationInstallments.startDate, to),
            gte(vacationInstallments.endDate, from),
          ),
        ),
      ex
        .select({ start: absences.startDate, end: absences.endDate })
        .from(absences)
        .where(and(eq(absences.tenantId, emp.tenantId), eq(absences.employeeId, emp.id), lte(absences.startDate, to), gte(absences.endDate, from))),
      loadLegalParameters(ex, emp.tenantId, emp.companyId),
    ]);
    const nightWorkType = resolveNightType(parameters, from, String(emp.companyId));

    const computed: ComputedDay[] = [];
    const skipped: SkippedDay[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const s = scheduleFor(date);
      if (!s) {
        skipped.push({ date, reason: 'sem_escala' });
        continue;
      }
      const placed = punchesOf(date);
      const previous = punchesOf(addDays(date, -1));
      const within = (r: { start: string; end: string }) => r.start <= date && date <= r.end;
      const h = holidayRows.get(date);
      const result = computeDay({
        workDate: date,
        companyId: String(emp.companyId),
        schedule: s.resolved.schedule,
        holiday: h ?? null,
        leave: vacationRows.some(within) ? 'ferias' : absenceRows.some(within) ? 'afastamento' : null,
        // Folga compensatória do domingo/feriado trabalhado ainda não é registrada (G8) [A CONFIRMAR]
        compensatoryRestGranted: false,
        punches: placed.map((p) => p.punch),
        previousShiftEnd: previous.length > 0 ? (previous.at(-1) as PlacedPunch).punch.at : null,
        nightWorkType,
        parameters,
      });
      computed.push({ date, endsAt: endOf.get(date) as Date, scheduleId: s.scheduleId, result, punches: placed });
    }
    return { computed, skipped };
  }

  /** Feriados não facultativos do estabelecimento: nacional, da UF, do município e os da conta. */
  private async holidays(ex: Executor, emp: EmployeeRecord, from: CivilDate, to: CivilDate) {
    const rows = await ex
      .select({ date: holidays.date, isWorked: establishmentHolidays.isWorked, treatment: establishmentHolidays.treatment })
      .from(holidays)
      .leftJoin(
        establishmentHolidays,
        and(eq(establishmentHolidays.holidayId, holidays.id), eq(establishmentHolidays.establishmentId, emp.establishmentId), eq(establishmentHolidays.tenantId, emp.tenantId)),
      )
      .where(
        and(
          between(holidays.date, from, to),
          eq(holidays.isOptional, false),
          or(isNull(holidays.tenantId), eq(holidays.tenantId, emp.tenantId)),
          or(
            eq(holidays.scope, 'nacional'),
            and(eq(holidays.scope, 'estadual'), eq(holidays.uf, emp.uf)),
            and(eq(holidays.scope, 'municipal'), eq(holidays.municipalityIbge, emp.municipalityIbge)),
          ),
        ),
      );
    const out = new Map<CivilDate, { worksOnHoliday: boolean; treatment: HolidayTreatment | null }>();
    for (const r of rows) out.set(r.date, { worksOnHoliday: r.isWorked ?? false, treatment: (r.treatment as HolidayTreatment | null) ?? null });
    return out;
  }

  // ------------------------------------------------------------------ gravação

  /** Devolve o id da apuração do dia. */
  private async persist(tx: Executor, emp: EmployeeRecord, day: ComputedDay, calculatedAt: Date): Promise<number> {
    const r = day.result;
    const values = {
      scheduleId: day.scheduleId,
      situation: r.situation,
      expectedMinutes: r.expectedMinutes,
      workedMinutes: r.workedMinutes,
      // falta = dia sem marcação + o que faltou além do atraso (saída antecipada) [A CONFIRMAR]
      absenceMinutes: r.absenceMinutes + Math.max(0, r.shortfallMinutes - r.lateMinutes),
      lateMinutes: r.lateMinutes,
      overtime50Minutes: r.overtime50Minutes,
      overtime100Minutes: r.overtime100Minutes,
      nightMinutes: r.nightEquivalentMinutes,
      breakMinutes: r.breakMinutes,
      isDsrDeducted: false,
      parameterVersion: r.parameterVersion,
      calculatedAt,
    };
    const [row] = await tx
      .insert(dailyTimesheets)
      .values({ tenantId: emp.tenantId, employeeId: emp.id, date: day.date, ...values })
      .onConflictDoUpdate({ target: [dailyTimesheets.employeeId, dailyTimesheets.date], set: values })
      .returning({ id: dailyTimesheets.id });
    const id = row!.id;

    await tx.delete(timesheetPunches).where(and(eq(timesheetPunches.tenantId, emp.tenantId), eq(timesheetPunches.dailyTimesheetId, id)));
    if (day.punches.length > 0) {
      await tx.insert(timesheetPunches).values(
        day.punches.map((p, i) => ({
          tenantId: emp.tenantId,
          dailyTimesheetId: id,
          sequence: i + 1,
          punchedAt: p.instant,
          origin: p.punch.origin,
          nsr: p.punch.nsr,
          adjustmentId: p.adjustmentId,
        })),
      );
    }

    // Inconsistência resolvida pelo RH fica (com quem resolveu); as que sumiram e não foram resolvidas saem.
    const types = toIssueTypes(r.inconsistencies);
    await tx
      .delete(timesheetIssues)
      .where(
        and(
          eq(timesheetIssues.tenantId, emp.tenantId),
          eq(timesheetIssues.dailyTimesheetId, id),
          eq(timesheetIssues.isResolved, false),
          types.length > 0 ? notInArray(timesheetIssues.type, types) : sql`true`,
        ),
      );
    if (types.length > 0) {
      await tx
        .insert(timesheetIssues)
        .values(types.map((type) => ({ tenantId: emp.tenantId, dailyTimesheetId: id, type })))
        .onConflictDoNothing({ target: [timesheetIssues.dailyTimesheetId, timesheetIssues.type] });
    }
    return id;
  }
}

/** Marcações, inconsistências e status de um lote de apurações da conta, na ordem de exibição. */
export async function loadDayDetails(ex: Executor, tenantId: number, ids: number[]) {
  const [punches, issues] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          ex
            .select()
            .from(timesheetPunches)
            .where(and(eq(timesheetPunches.tenantId, tenantId), inArray(timesheetPunches.dailyTimesheetId, ids)))
            .orderBy(asc(timesheetPunches.sequence)),
          ex
            .select()
            .from(timesheetIssues)
            .where(and(eq(timesheetIssues.tenantId, tenantId), inArray(timesheetIssues.dailyTimesheetId, ids)))
            .orderBy(asc(timesheetIssues.type)),
        ]);
  return (id: number): Pick<TimesheetDayDto, 'status' | 'punches' | 'issues'> => {
    const dayIssues = issues.filter((i) => i.dailyTimesheetId === id).map((i) => ({ type: i.type as IssueType, resolved: i.isResolved }));
    return {
      status: dayIssues.some((i) => !i.resolved && BLOCKING_ISSUE_TYPES.includes(i.type)) ? 'inconsistente' : 'calculada',
      punches: punches
        .filter((p) => p.dailyTimesheetId === id)
        .map((p) => ({ sequence: p.sequence, at: p.punchedAt.toISOString(), origin: p.origin as 'original' | 'tratada', nsr: p.nsr, adjustmentId: p.adjustmentId })),
      issues: dayIssues,
    };
  };
}

function resolveNightType(rows: readonly LegalParameterRow[], date: CivilDate, companyId: string): NightWorkType {
  try {
    const value = new ParameterReader(rows, date, { companyId }).row(NIGHT_TYPE_KEY).value;
    if (typeof value === 'string' && (NIGHT_TYPES as readonly string[]).includes(value)) return value as NightWorkType;
  } catch {
    // sem a linha: urbano
  }
  return 'urbano';
}

export function assertRange(from: CivilDate, to: CivilDate, maxDays: number): void {
  if (to < from) throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'to', message: 'fim antes do início' }]);
  if (diffDays(from, to) + 1 > maxDays) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path: 'to', message: `no máximo ${maxDays} dias por vez` }]);
  }
}

