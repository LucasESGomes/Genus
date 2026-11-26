/**
 * Acesso ao banco de horas (`lancamentos_banco_horas` e `regras_banco_horas`).
 * Toda consulta filtra por `conta_id`. O ledger só recebe INSERT.
 */
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { departments, employeeAssignments, employees, establishments, timeBankEntries, timeBankPolicies } from '../../db/schema';
import type { CivilDate } from '../rules-common/rules/civil-time';
import type { TimeBankEntry, TimeBankEntryType, TimeBankModality } from './rules/ledger';

export type PolicyRow = typeof timeBankPolicies.$inferSelect;
export type PolicyValues = Pick<PolicyRow, 'modality' | 'sundayWeight' | 'holidayWeight'>;

export type LedgerEntry = TimeBankEntry & { employeeId: number };

/** Regra que vale na data: a do colaborador vence a do estabelecimento. */
export async function findPolicyOn(
  ex: Executor,
  scope: { tenantId: number; employeeId: number; establishmentId: number },
  date: CivilDate,
): Promise<(Omit<PolicyRow, 'modality'> & { modality: TimeBankModality }) | null> {
  const [row] = await ex
    .select()
    .from(timeBankPolicies)
    .where(
      and(
        eq(timeBankPolicies.tenantId, scope.tenantId),
        or(eq(timeBankPolicies.employeeId, scope.employeeId), eq(timeBankPolicies.establishmentId, scope.establishmentId)),
        lte(timeBankPolicies.validFrom, date),
        or(isNull(timeBankPolicies.validTo), gte(timeBankPolicies.validTo, date)),
      ),
    )
    .orderBy(sql`${timeBankPolicies.employeeId} IS NULL`, desc(timeBankPolicies.validFrom), desc(timeBankPolicies.id))
    .limit(1);
  return row ? { ...row, modality: row.modality as TimeBankModality } : null;
}

export function listEstablishmentPolicies(ex: Executor, tenantId: number, establishmentId: number): Promise<PolicyRow[]> {
  return ex
    .select()
    .from(timeBankPolicies)
    .where(and(eq(timeBankPolicies.tenantId, tenantId), eq(timeBankPolicies.establishmentId, establishmentId)))
    .orderBy(asc(timeBankPolicies.validFrom), asc(timeBankPolicies.id));
}

export async function insertPolicy(ex: Executor, values: typeof timeBankPolicies.$inferInsert): Promise<PolicyRow> {
  const [row] = await ex.insert(timeBankPolicies).values(values).returning();
  return row!;
}

export async function updatePolicy(
  ex: Executor,
  tenantId: number,
  id: number,
  values: Partial<PolicyValues> & { validTo?: CivilDate },
): Promise<PolicyRow> {
  const [row] = await ex
    .update(timeBankPolicies)
    .set(values)
    .where(and(eq(timeBankPolicies.tenantId, tenantId), eq(timeBankPolicies.id, id)))
    .returning();
  return row!;
}

/** Soma do que a apuração já lançou para um dia. */
export async function postedMinutes(ex: Executor, tenantId: number, employeeId: number, dailyTimesheetId: number): Promise<number> {
  const rows = await ex
    .select({ minutes: timeBankEntries.minutes })
    .from(timeBankEntries)
    .where(
      and(
        eq(timeBankEntries.tenantId, tenantId),
        eq(timeBankEntries.employeeId, employeeId),
        eq(timeBankEntries.dailyTimesheetId, dailyTimesheetId),
        inArray(timeBankEntries.type, ['credito', 'debito']),
      ),
    );
  return rows.reduce((s, r) => s + r.minutes, 0);
}

export async function insertEntry(ex: Executor, values: typeof timeBankEntries.$inferInsert): Promise<void> {
  await ex.insert(timeBankEntries).values(values);
}

/** Extrato dos colaboradores, do lançamento mais antigo para o mais novo. */
export async function listEntries(ex: Executor, tenantId: number, employeeIds: number[]): Promise<LedgerEntry[]> {
  if (employeeIds.length === 0) return [];
  const rows = await ex
    .select({
      id: timeBankEntries.id,
      employeeId: timeBankEntries.employeeId,
      type: timeBankEntries.type,
      minutes: timeBankEntries.minutes,
      competenceDate: timeBankEntries.referenceDate,
      dueDate: timeBankEntries.dueDate,
      dailyTimesheetId: timeBankEntries.dailyTimesheetId,
    })
    .from(timeBankEntries)
    .where(and(eq(timeBankEntries.tenantId, tenantId), inArray(timeBankEntries.employeeId, employeeIds)))
    .orderBy(asc(timeBankEntries.referenceDate), asc(timeBankEntries.id));
  return rows.map((r) => ({
    ...r,
    // id com zeros à esquerda: a ordem do texto é a ordem do número no desempate do FIFO.
    id: String(r.id).padStart(19, '0'),
    type: r.type as TimeBankEntryType,
    dailyTimesheetId: r.dailyTimesheetId === null ? null : String(r.dailyTimesheetId),
  }));
}

export async function findEstablishment(ex: Executor, tenantId: number, establishmentId: number, lock = false) {
  const query = ex
    .select({ id: establishments.id, uf: establishments.uf })
    .from(establishments)
    .where(and(eq(establishments.tenantId, tenantId), eq(establishments.id, establishmentId)));
  // `no key update` serializa as trocas de regra sem travar quem só referencia o estabelecimento.
  const [row] = lock ? await query.for('no key update') : await query;
  return row ?? null;
}

/** Colaboradores da lista de saldos, com o setor do vínculo vigente em `today`. */
export async function pageEmployees(ex: Executor, tenantId: number, conditions: SQL[], today: CivilDate, page: number, pageSize: number) {
  const where = and(eq(employees.tenantId, tenantId), ...conditions);
  const [rows, [total]] = await Promise.all([
    ex
      .select({ id: employees.id, name: employees.name, departmentName: departments.name })
      .from(employees)
      .leftJoin(
        employeeAssignments,
        and(
          eq(employeeAssignments.tenantId, employees.tenantId),
          eq(employeeAssignments.employeeId, employees.id),
          lte(employeeAssignments.validFrom, today),
          or(isNull(employeeAssignments.validTo), gte(employeeAssignments.validTo, today)),
        ),
      )
      .leftJoin(departments, and(eq(departments.tenantId, employeeAssignments.tenantId), eq(departments.id, employeeAssignments.departmentId)))
      .where(where)
      .orderBy(asc(employees.name), asc(employees.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    ex.select({ n: count() }).from(employees).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}
