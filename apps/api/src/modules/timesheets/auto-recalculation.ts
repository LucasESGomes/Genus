/**
 * Apuração automática (G4): o que a fila `day-recalculation` manda fazer.
 *
 * - `recalculate-day` (uma batida ganhou NSR): lê o registro no arp pela chave,
 *   acha o colaborador pelo CPF e recalcula o dia anterior, o dia e o seguinte
 *   (até hoje), porque a batida pode pertencer a uma jornada que virou o dia.
 * - `close-days` (de hora em hora): falta e fim de dia não geram batida. Nos
 *   últimos 3 dias, recalcula quem tem escala e cujo dia, já encerrado, não
 *   existe ou foi calculado antes de encerrar.
 *
 * Roda sem sessão: o `tenantId` vem do job (gravado pelo rep-core) ou da lista de
 * contas, e toda consulta filtra por ele. Período fechado, CPF sem cadastro e
 * falta de escala concluem o job; erro de banco ou de parâmetro sobe, para a fila
 * tentar de novo. Log só com ids: nunca CPF nem nome.
 */
import type { Clock, Logger } from '@genus/shared';
import { and, asc, between, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import type { ArpPunchKey, ArpPunchLookup, ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import { dailyTimesheets, employees, employeeSchedules, tenants } from '../../db/schema';
import { findEmployeeByCpf, type EmployeeRecord } from '../employees/lookup';
import { addDays, type CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import type { DayPostingHook } from '../time-bank/posting-hook';
import { describeError } from './describe-error';
import { isEmployedOn, listEmployeeRecords } from './employee-records';
import { dayEndsAt, loadScheduleResolver } from './schedule-window';
import { TimesheetService } from './service';

/** Quantos dias para trás o `close-days` confere. */
export const CLOSE_DAYS_LOOKBACK = 3;
const EMPLOYEE_BATCH = 500;

export interface AutoRecalculationDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader & ArpPunchLookup;
  logger: Logger;
  posting?: DayPostingHook | undefined;
}

export interface CloseDaysResult {
  recalculated: number;
  skipped: number;
}

export class CloseDaysError extends Error {
  override readonly name = 'CloseDaysError';
  constructor(readonly failed: number) {
    super(`close-days: ${failed} dia(s) não puderam ser calculados`);
  }
}

export class AutoRecalculationService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: AutoRecalculationDeps) {
    this.timesheets = new TimesheetService(d);
  }

  async recalculateForPunch(key: ArpPunchKey): Promise<void> {
    const ids = { tenantId: key.tenantId, establishmentId: key.establishmentId, nsr: key.nsr };
    const punch = await this.d.arp.findPunch(key);
    if (!punch) {
      this.d.logger.warn({ event: 'day_recalculation_record_not_found', ...ids }, 'apuração: registro não encontrado no arp');
      return;
    }
    const emp = await findEmployeeByCpf(this.d.db, key.tenantId, punch.cpf);
    if (!emp) {
      this.d.logger.warn({ event: 'day_recalculation_employee_not_found', ...ids }, 'apuração: batida sem colaborador cadastrado');
      return;
    }
    const tz = timezoneForUf(emp.uf);
    const date = toCivilDate(punch.markedAt, tz);
    const today = toCivilDate(this.d.clock.now(), tz);
    // Os vizinhos fora do contrato não são calculados (não viram falta antes da admissão).
    const dates = [addDays(date, -1), date, addDays(date, 1)].filter((day) => day <= today && (day === date || isEmployedOn(emp, day)));
    for (const day of dates) {
      const outcome = await this.timesheets.recalculateDay(emp, day);
      if (outcome !== 'recalculado') {
        this.d.logger.info({ event: 'day_recalculation_skipped', ...ids, employeeId: emp.id, date: day, reason: outcome }, 'apuração: dia não recalculado');
      }
    }
  }

  async closeDays(): Promise<CloseDaysResult> {
    const result: CloseDaysResult = { recalculated: 0, skipped: 0 };
    let failed = 0;
    // Processo de infraestrutura: percorre as contas e, em cada uma, filtra por `conta_id`.
    const accounts = await this.d.db.select({ id: tenants.id }).from(tenants).orderBy(asc(tenants.id));
    for (const account of accounts) failed += await this.closeTenantDays(account.id, result);
    this.d.logger.info({ event: 'close_days_round', ...result, failed }, 'apuração: encerramento de dias concluído');
    if (failed > 0) throw new CloseDaysError(failed);
    return result;
  }

  /** Devolve quantos dias falharam; um colaborador com erro não segura os outros. */
  private async closeTenantDays(tenantId: number, result: CloseDaysResult): Promise<number> {
    const now = this.d.clock.now();
    // Folga para o fuso: o "hoje" local nunca passa do UTC e fica no máximo um dia atrás.
    const utcToday = toCivilDate(now, 'UTC');
    const from = addDays(utcToday, -(CLOSE_DAYS_LOOKBACK + 1));
    const withSchedule = this.d.db
      .select({ id: employeeSchedules.employeeId })
      .from(employeeSchedules)
      .where(
        and(
          eq(employeeSchedules.tenantId, tenantId),
          lte(employeeSchedules.validFrom, utcToday),
          or(isNull(employeeSchedules.validTo), gte(employeeSchedules.validTo, from)),
        ),
      );
    const candidates = await listEmployeeRecords(this.d.db, [
      eq(employees.tenantId, tenantId),
      inArray(employees.id, withSchedule),
      lte(employees.admissionDate, utcToday),
      or(isNull(employees.terminationDate), gte(employees.terminationDate, from)) as SQL,
    ]);

    let failed = 0;
    for (let i = 0; i < candidates.length; i += EMPLOYEE_BATCH) {
      const batch = candidates.slice(i, i + EMPLOYEE_BATCH);
      for (const { emp, date } of await this.pendingDays(tenantId, batch, from, utcToday, now)) {
        try {
          const outcome = await this.timesheets.recalculateDay(emp, date);
          if (outcome === 'recalculado') result.recalculated += 1;
          else result.skipped += 1;
        } catch (err) {
          failed += 1;
          this.d.logger.warn(
            { event: 'close_days_employee_failed', tenantId, employeeId: emp.id, date, err: describeError(err) },
            'apuração: falha ao encerrar o dia',
          );
        }
      }
    }
    return failed;
  }

  /** Dias encerrados, com escala, sem apuração feita depois do encerramento. */
  private async pendingDays(tenantId: number, batch: EmployeeRecord[], from: CivilDate, to: CivilDate, now: Date) {
    const ids = batch.map((e) => e.id);
    const resolve = await loadScheduleResolver(this.d.db, tenantId, ids, from, to);
    const calculated = await this.d.db
      .select({ employeeId: dailyTimesheets.employeeId, date: dailyTimesheets.date, calculatedAt: dailyTimesheets.calculatedAt })
      .from(dailyTimesheets)
      .where(and(eq(dailyTimesheets.tenantId, tenantId), inArray(dailyTimesheets.employeeId, ids), between(dailyTimesheets.date, from, to)));
    const calculatedAt = new Map(calculated.map((r) => [`${r.employeeId}:${r.date}`, r.calculatedAt.getTime()]));

    const pending: { emp: EmployeeRecord; date: CivilDate }[] = [];
    for (const emp of batch) {
      const tz = timezoneForUf(emp.uf);
      const today = toCivilDate(now, tz);
      for (let back = CLOSE_DAYS_LOOKBACK; back >= 1; back -= 1) {
        const date = addDays(today, -back);
        const schedule = resolve(emp.id, date);
        if (!schedule || !isEmployedOn(emp, date)) continue;
        const endsAt = dayEndsAt(date, schedule, tz).getTime();
        if (now.getTime() < endsAt) continue;
        const done = calculatedAt.get(`${emp.id}:${date}`);
        if (done !== undefined && done >= endsAt) continue;
        pending.push({ emp, date });
      }
    }
    return pending;
  }
}
