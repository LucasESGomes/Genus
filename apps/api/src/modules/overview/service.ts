/**
 * Visão geral do estabelecimento (G11): KPIs com variação contra o período anterior,
 * série diária, situação dos dias, quem mais fez hora extra e alertas.
 *
 * Tudo sai de `apuracoes_dia` e das tabelas do RH, nunca do `arp`. Escopo da sessão:
 * conta, estabelecimentos do usuário e equipe do gestor. Empresa nova: listas vazias
 * e zeros (o front mostra o estado vazio). Nenhum dado de saúde sai daqui: atestado
 * só entra como contagem.
 */
import type { Clock } from '@genus/shared';
import { and, between, count, desc, eq, gte, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import {
  dailyTimesheets,
  employees,
  employeeSchedules,
  establishments,
  medicalCertificates,
  timeAdjustments,
  timesheetIssues,
  vacationInstallments,
} from '../../db/schema';
import { employeeScopeConditions, establishmentInScope, notFound, tenantOf } from '../../http/access';
import type { RequestContext } from '../../plugins/request-context';
import { addDays, type CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import { listEntries } from '../time-bank/repository';
import { timeBankSummary } from '../time-bank/rules/ledger';
import { BLOCKING_ISSUE_TYPES } from '../timesheets/issue-codes';
import { count as fmtCount, datesBetween, hours, previousPeriod, toneFor, variation } from './rules/kpis';
import type { OverviewDto, overviewQuery } from './schemas';

export interface OverviewServiceDeps {
  db: Database;
  clock: Clock;
}

type Kpi = OverviewDto['kpis'][number];
type Alert = OverviewDto['alerts'][number];

const fmtDate = (d: CivilDate) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const plural = (n: number, one: string, many: string) => `${fmtCount(n)} ${n === 1 ? one : many}`;

export class OverviewService {
  constructor(private readonly d: OverviewServiceDeps) {}

  async get(ctx: RequestContext, q: z.infer<typeof overviewQuery>): Promise<OverviewDto> {
    const tenantId = tenantOf(ctx);
    const db = this.d.db;
    const [est] = await db
      .select({ id: establishments.id, uf: establishments.uf })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, q.establishmentId)))
      .limit(1);
    if (!est || !establishmentInScope(ctx, est.id)) throw notFound('Estabelecimento');

    const today = toCivilDate(this.d.clock.now(), timezoneForUf(est.uf));
    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -29);
    const prev = previousPeriod(from, to);

    /** Colaboradores do escopo neste estabelecimento. */
    const scope: SQL[] = [...employeeScopeConditions(ctx), eq(employees.establishmentId, est.id)];
    const active = and(...scope, or(isNull(employees.terminationDate), gte(employees.terminationDate, today)))!;

    const inconsistent = sql<boolean>`EXISTS (SELECT 1 FROM ${timesheetIssues} WHERE ${timesheetIssues.tenantId} = ${dailyTimesheets.tenantId}
      AND ${timesheetIssues.dailyTimesheetId} = ${dailyTimesheets.id} AND ${timesheetIssues.isResolved} = false
      AND ${inArray(timesheetIssues.type, [...BLOCKING_ISSUE_TYPES])})`;
    const overtime = sql`${dailyTimesheets.overtime50Minutes} + ${dailyTimesheets.overtime100Minutes}`;

    const dayAgg = (a: CivilDate, b: CivilDate) =>
      db
        .select({
          worked: sql<number>`COALESCE(SUM(${dailyTimesheets.workedMinutes}), 0)::int`,
          overtime: sql<number>`COALESCE(SUM(${overtime}), 0)::int`,
          absences: sql<number>`COUNT(*) FILTER (WHERE ${dailyTimesheets.situation} = 'falta')::int`,
          inconsistent: sql<number>`COUNT(*) FILTER (WHERE ${inconsistent})::int`,
          days: sql<number>`COUNT(*)::int`,
        })
        .from(dailyTimesheets)
        .innerJoin(employees, and(eq(employees.tenantId, dailyTimesheets.tenantId), eq(employees.id, dailyTimesheets.employeeId)))
        .where(and(eq(dailyTimesheets.tenantId, tenantId), between(dailyTimesheets.date, a, b), ...scope));

    const [cur, before, byDay, top, headcount, withoutSchedule, adjustments, certificates, vacations, scopedIds] = await Promise.all([
      dayAgg(from, to).then((r) => r[0]!),
      dayAgg(prev.from, prev.to).then((r) => r[0]!),
      db
        .select({
          date: dailyTimesheets.date,
          worked: sql<number>`COALESCE(SUM(${dailyTimesheets.workedMinutes}), 0)::int`,
          overtime: sql<number>`COALESCE(SUM(${overtime}), 0)::int`,
          absences: sql<number>`COUNT(*) FILTER (WHERE ${dailyTimesheets.situation} = 'falta')::int`,
          inconsistent: sql<number>`COUNT(*) FILTER (WHERE ${inconsistent})::int`,
        })
        .from(dailyTimesheets)
        .innerJoin(employees, and(eq(employees.tenantId, dailyTimesheets.tenantId), eq(employees.id, dailyTimesheets.employeeId)))
        .where(and(eq(dailyTimesheets.tenantId, tenantId), between(dailyTimesheets.date, from, to), ...scope))
        .groupBy(dailyTimesheets.date),
      db
        .select({ employeeId: employees.id, name: employees.name, overtimeMinutes: sql<number>`SUM(${overtime})::int` })
        .from(dailyTimesheets)
        .innerJoin(employees, and(eq(employees.tenantId, dailyTimesheets.tenantId), eq(employees.id, dailyTimesheets.employeeId)))
        .where(and(eq(dailyTimesheets.tenantId, tenantId), between(dailyTimesheets.date, from, to), ...scope))
        .groupBy(employees.id, employees.name)
        .having(sql`SUM(${overtime}) > 0`)
        .orderBy(desc(sql`SUM(${overtime})`), employees.name)
        .limit(5),
      db.select({ n: count() }).from(employees).where(active).then((r) => r[0]!.n),
      db
        .select({ n: count() })
        .from(employees)
        .where(
          and(
            active,
            sql`NOT EXISTS (SELECT 1 FROM ${employeeSchedules} WHERE ${employeeSchedules.tenantId} = ${employees.tenantId}
              AND ${employeeSchedules.employeeId} = ${employees.id} AND ${employeeSchedules.validFrom} <= ${today}
              AND (${employeeSchedules.validTo} IS NULL OR ${employeeSchedules.validTo} >= ${today}))`,
          ),
        )
        .then((r) => r[0]!.n),
      db
        .select({
          pending: sql<number>`COUNT(*) FILTER (WHERE ${timeAdjustments.status} = 'pendente')::int`,
          received: sql<number>`COUNT(*) FILTER (WHERE ${timeAdjustments.date} BETWEEN ${from} AND ${to})::int`,
        })
        .from(timeAdjustments)
        .innerJoin(employees, and(eq(employees.tenantId, timeAdjustments.tenantId), eq(employees.id, timeAdjustments.employeeId)))
        .where(and(eq(timeAdjustments.tenantId, tenantId), ...scope))
        .then((r) => r[0]!),
      db
        .select({
          pending: sql<number>`COUNT(*) FILTER (WHERE ${medicalCertificates.status} = 'pendente')::int`,
          received: sql<number>`COUNT(*) FILTER (WHERE ${medicalCertificates.startDate} BETWEEN ${from} AND ${to})::int`,
        })
        .from(medicalCertificates)
        .innerJoin(employees, and(eq(employees.tenantId, medicalCertificates.tenantId), eq(employees.id, medicalCertificates.employeeId)))
        .where(and(eq(medicalCertificates.tenantId, tenantId), ...scope))
        .then((r) => r[0]!),
      db
        .select({
          now: sql<number>`COUNT(DISTINCT ${vacationInstallments.employeeId}) FILTER (WHERE ${vacationInstallments.startDate} <= ${today} AND ${vacationInstallments.endDate} >= ${today})::int`,
          next30: sql<number>`COUNT(*) FILTER (WHERE ${vacationInstallments.startDate} > ${today} AND ${vacationInstallments.startDate} <= ${addDays(today, 30)})::int`,
        })
        .from(vacationInstallments)
        .innerJoin(employees, and(eq(employees.tenantId, vacationInstallments.tenantId), eq(employees.id, vacationInstallments.employeeId)))
        .where(and(eq(vacationInstallments.tenantId, tenantId), inArray(vacationInstallments.status, ['aprovada', 'gozada']), ...scope))
        .then((r) => r[0]!),
      db.select({ id: employees.id }).from(employees).where(active),
    ]);

    // Banco de horas: saldo FIFO por colaborador (mesma regra da tela do banco).
    const entries = await listEntries(db, tenantId, scopedIds.map((r) => r.id));
    const byEmployee = new Map<number, typeof entries>();
    for (const e of entries) byEmployee.set(e.employeeId, [...(byEmployee.get(e.employeeId) ?? []), e]);
    let balance = 0;
    let expiring = 0;
    for (const list of byEmployee.values()) {
      const s = timeBankSummary(list, today);
      balance += s.balanceMinutes;
      expiring += s.expiringIn30DaysMinutes;
    }

    const comparison = `vs. ${fmtDate(prev.from)} a ${fmtDate(prev.to)}`;
    const kpis: Kpi[] = [
      { key: 'workedHours', label: 'Horas trabalhadas', value: hours(cur.worked), unit: 'h', ...variation(cur.worked, before.worked, hours), tone: toneFor('higherIsBetter', cur.worked, before.worked), comparison },
      { key: 'overtimeHours', label: 'Horas extras', value: hours(cur.overtime), unit: 'h', ...variation(cur.overtime, before.overtime, hours), tone: toneFor('lowerIsBetter', cur.overtime, before.overtime), comparison },
      { key: 'absences', label: 'Faltas', value: fmtCount(cur.absences), unit: cur.absences === 1 ? 'dia' : 'dias', ...variation(cur.absences, before.absences, fmtCount), tone: toneFor('lowerIsBetter', cur.absences, before.absences), comparison },
      { key: 'pendingAdjustments', label: 'Ajustes pendentes', value: fmtCount(adjustments.pending), unit: '', delta: `+${fmtCount(adjustments.received)}`, trend: 'up', tone: adjustments.pending > 0 ? 'warn' : 'good', comparison: 'pedidos no período' },
      { key: 'pendingCertificates', label: 'Atestados pendentes', value: fmtCount(certificates.pending), unit: '', delta: `+${fmtCount(certificates.received)}`, trend: 'up', tone: certificates.pending > 0 ? 'warn' : 'good', comparison: 'recebidos no período' },
      { key: 'activeVacations', label: 'Em férias hoje', value: fmtCount(vacations.now), unit: '', delta: `+${fmtCount(vacations.next30)}`, trend: 'up', tone: 'neutral', comparison: 'começam em 30 dias' },
      { key: 'timeBankBalance', label: 'Saldo do banco de horas', value: `${balance < 0 ? '−' : ''}${hours(Math.abs(balance))}`, unit: 'h', delta: hours(expiring), trend: expiring > 0 ? 'up' : 'down', tone: expiring > 0 ? 'warn' : 'neutral', comparison: 'h vencem em 30 dias' },
    ];

    const perDay = new Map(byDay.map((r) => [r.date, r]));
    const series = datesBetween(from, to).map((date) => {
      const r = perDay.get(date);
      return { date, workedMinutes: r?.worked ?? 0, overtimeMinutes: r?.overtime ?? 0, absences: r?.absences ?? 0, inconsistent: r?.inconsistent ?? 0 };
    });

    const alerts: Alert[] = [];
    if (cur.inconsistent > 0)
      alerts.push({ id: 'inconsistent-days', severity: 'alerta', title: `${plural(cur.inconsistent, 'dia inconsistente', 'dias inconsistentes')}`, text: 'Há pendências na apuração que impedem o fechamento do período.', cta: 'Revisar apuração', target: 'apuracao' });
    if (withoutSchedule > 0)
      alerts.push({ id: 'without-schedule', severity: 'alerta', title: `${plural(withoutSchedule, 'colaborador sem escala', 'colaboradores sem escala')}`, text: 'Sem escala vigente hoje, o dia não é apurado e não há falta nem hora extra.', cta: 'Ver colaboradores', target: 'colaboradores' });
    if (adjustments.pending > 0)
      alerts.push({ id: 'pending-adjustments', severity: 'sinal', title: `${plural(adjustments.pending, 'ajuste aguardando decisão', 'ajustes aguardando decisão')}`, text: 'Pedidos de inclusão de batida, justificativa ou abono.', cta: 'Decidir ajustes', target: 'ajustes' });
    if (certificates.pending > 0)
      alerts.push({ id: 'pending-certificates', severity: 'sinal', title: `${plural(certificates.pending, 'atestado para analisar', 'atestados para analisar')}`, text: 'O dia só vira afastamento depois de aprovado.', cta: 'Analisar atestados', target: 'atestados' });
    if (expiring > 0)
      alerts.push({ id: 'time-bank-expiring', severity: 'sinal', title: `${hours(expiring)} h do banco vencem em 30 dias`, text: 'O crédito vencido segue a política do banco de horas do estabelecimento.', cta: 'Ver banco de horas', target: 'banco-horas' });

    return {
      period: { from, to },
      previousPeriod: prev,
      activeEmployees: headcount,
      calculatedDays: cur.days,
      kpis,
      series,
      statusBreakdown: { inconsistente: cur.inconsistent, falta: cur.absences, calculada: Math.max(cur.days - cur.inconsistent - cur.absences, 0) },
      topOvertime: top,
      alerts,
    };
  }
}
