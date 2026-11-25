/**
 * Regras puras das estatísticas do super_admin: janelas, preenchimento de dias e meses sem dado
 * e taxas. Tudo em UTC (o arp e `contas.criado_em` não carregam o fuso do estabelecimento).
 */
import type { StatsWindow } from '../../contract';

const DAY_MS = 86_400_000;

export const WINDOW_MS: Record<StatsWindow, number> = { '24h': DAY_MS, '7d': 7 * DAY_MS, '30d': 30 * DAY_MS };

/** `[from, to)` da janela, terminando em `now`. */
export function windowRange(window: StatsWindow, now: Date): { from: Date; to: Date } {
  return { from: new Date(now.getTime() - WINDOW_MS[window]), to: now };
}

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Fração 0–1 com 4 casas; null sem batidas. */
export function processedRate(processed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((processed / total) * 10_000) / 10_000;
}

export interface DayCount {
  day: string;
  punches: number;
}

/** Um item por dia UTC de `from` até o dia de `to - 1 ms` (inclusive), com 0 onde não há batida. */
export function fillDays(from: Date, to: Date, rows: readonly DayCount[]): DayCount[] {
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.punches);
  const out: DayCount[] = [];
  const last = utcDay(new Date(Math.max(from.getTime(), to.getTime() - 1)));
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); ; t += DAY_MS) {
    const day = utcDay(new Date(t));
    if (day > last) break;
    out.push({ day, punches: byDay.get(day) ?? 0 });
  }
  return out;
}

export interface PunchRow {
  day: string;
  tenantId: number;
  punches: number;
  processed: number;
}

export interface PunchTotals {
  punches: number;
  processed: number;
  perDay: DayCount[];
  perTenant: Map<number, number>;
}

export function totalizePunches(rows: readonly PunchRow[], from: Date, to: Date): PunchTotals {
  let punches = 0;
  let processed = 0;
  const perTenant = new Map<number, number>();
  for (const r of rows) {
    punches += r.punches;
    processed += r.processed;
    perTenant.set(r.tenantId, (perTenant.get(r.tenantId) ?? 0) + r.punches);
  }
  return { punches, processed, perDay: fillDays(from, to, rows), perTenant };
}

/** Maiores por batidas (desempate pelo menor id, para a ordem ser estável). */
export function topByPunches(perTenant: ReadonlyMap<number, number>, limit: number): { tenantId: number; punches: number }[] {
  return [...perTenant.entries()]
    .map(([tenantId, punches]) => ({ tenantId, punches }))
    .sort((a, b) => b.punches - a.punches || a.tenantId - b.tenantId)
    .slice(0, limit);
}

export interface MonthCount {
  month: string;
  count: number;
}

export interface GrowthPoint {
  month: string;
  newTenants: number;
  totalTenants: number;
  newEmployees: number;
  totalEmployees: number;
}

/** `YYYY-MM` dos últimos `months` meses UTC, o mais antigo primeiro, terminando no mês de `now`. */
export function lastMonths(months: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** Primeiro instante (UTC) do mais antigo dos `months` meses. */
export function growthStart(months: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}

/**
 * Série mensal com acumulado. `*Before` = quantos já existiam antes do primeiro mês da série;
 * meses sem novidade entram com 0 e repetem o total.
 */
export function buildGrowth(
  months: readonly string[],
  tenants: { before: number; byMonth: readonly MonthCount[] },
  employees: { before: number; byMonth: readonly MonthCount[] },
): GrowthPoint[] {
  const t = new Map(tenants.byMonth.map((r) => [r.month, r.count]));
  const e = new Map(employees.byMonth.map((r) => [r.month, r.count]));
  let totalTenants = tenants.before;
  let totalEmployees = employees.before;
  return months.map((month) => {
    const newTenants = t.get(month) ?? 0;
    const newEmployees = e.get(month) ?? 0;
    totalTenants += newTenants;
    totalEmployees += newEmployees;
    return { month, newTenants, totalTenants, newEmployees, totalEmployees };
  });
}
