/**
 * Banco de horas (G8): saldos, extrato e regra do estabelecimento. O saldo é
 * sempre a soma do ledger; "a vencer" e "próximo vencimento" saem do FIFO das
 * regras puras (a view só soma créditos brutos). "Hoje" é o dia no fuso do
 * estabelecimento.
 */
import type { Clock } from '@genus/shared';
import { eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import type { Executor } from '../../db/executor';
import { employees } from '../../db/schema';
import { employeeScopeConditions, establishmentInScope, notFound, tenantOf } from '../../http/access';
import { containsAny } from '../../http/search';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { findEmployeeInScope } from '../employees/lookup';
import type { CivilDate } from '../rules-common/rules/civil-time';
import { timezoneForUf, toCivilDate } from '../rules-common/rules/timezone';
import {
  findEstablishment,
  insertPolicy,
  listEntries,
  listEstablishmentPolicies,
  pageEmployees,
  updatePolicy,
  type LedgerEntry,
  type PolicyRow,
} from './repository';
import { timeBankSummary, type TimeBankModality } from './rules/ledger';
import { currentOrNextPolicy, planPolicyChange } from './rules/policy-validity';
import type { balancesQuery, policyBody, PolicyDto, TimeBankDto } from './schemas';

const AUDIT_ENTITY = 'regras_banco_horas';

export interface TimeBankServiceDeps {
  db: Database;
  clock: Clock;
}

export class TimeBankService {
  constructor(private readonly d: TimeBankServiceDeps) {}

  /** Saldos dos colaboradores ativos de um estabelecimento (o gestor vê só a equipe). */
  async balances(ctx: RequestContext, q: z.infer<typeof balancesQuery>) {
    const tenantId = tenantOf(ctx);
    const establishment = await this.establishmentInScope(this.d.db, ctx, q.establishmentId);
    const today = this.today(establishment.uf);
    const conditions = [...employeeScopeConditions(ctx), eq(employees.establishmentId, q.establishmentId), isNull(employees.terminationDate)];
    if (q.q) conditions.push(containsAny([employees.name, employees.registrationNumber], q.q));

    const { rows, total } = await pageEmployees(this.d.db, tenantId, conditions, today, q.page, q.pageSize);
    const byEmployee = new Map<number, LedgerEntry[]>(rows.map((r) => [r.id, []]));
    for (const entry of await listEntries(this.d.db, tenantId, [...byEmployee.keys()])) byEmployee.get(entry.employeeId)?.push(entry);

    return {
      data: rows.map((r) => ({
        employeeId: r.id,
        employeeName: r.name,
        departmentName: r.departmentName,
        ...timeBankSummary(byEmployee.get(r.id) ?? [], today),
      })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  /** Saldo e extrato de um colaborador no escopo de quem pede (o próprio, para o colaborador). */
  async forEmployee(ctx: RequestContext, employeeId: number): Promise<TimeBankDto> {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const entries = await listEntries(this.d.db, emp.tenantId, [emp.id]);
    const { balanceMinutes, expiringIn30DaysMinutes } = timeBankSummary(entries, this.today(emp.uf));
    return {
      balanceMinutes,
      expiringIn30DaysMinutes,
      entries: entries.map((e) => ({ date: e.competenceDate, type: e.type, minutes: e.minutes, dueDate: e.dueDate })),
    };
  }

  /** Regra do estabelecimento que vale hoje ou a próxima. */
  async policy(ctx: RequestContext, establishmentId: number): Promise<PolicyDto | null> {
    const establishment = await this.establishmentInScope(this.d.db, ctx, establishmentId);
    const rows = await listEstablishmentPolicies(this.d.db, tenantOf(ctx), establishmentId);
    const row = currentOrNextPolicy(rows, this.today(establishment.uf));
    return row ? toPolicyDto(row, establishmentId) : null;
  }

  /** `vigencia_anterior` = o início pedido vem antes da regra vigente; nada é gravado. */
  async savePolicy(ctx: RequestContext, establishmentId: number, body: z.infer<typeof policyBody>): Promise<PolicyDto | 'vigencia_anterior'> {
    const tenantId = tenantOf(ctx);
    return this.d.db.transaction(async (tx) => {
      const establishment = await this.establishmentInScope(tx, ctx, establishmentId, true);
      const rows = await listEstablishmentPolicies(tx, tenantId, establishmentId);
      const change = planPolicyChange(rows, body.validFrom, this.today(establishment.uf));
      if (change.kind === 'conflict') return 'vigencia_anterior';

      const values = { modality: body.modality, sundayWeight: body.sundayWeight, holidayWeight: body.holidayWeight };
      const audit = (entityId: number, action: 'criacao' | 'alteracao', before: PolicyRow | null, after: PolicyRow) =>
        recordAudit(tx, this.d.clock, {
          tenantId,
          userId: ctx.userId,
          entity: AUDIT_ENTITY,
          entityId,
          action,
          before: before ? toPolicyDto(before, establishmentId) : null,
          after: toPolicyDto(after, establishmentId),
        });

      if (change.kind === 'update') {
        const before = rows.find((r) => r.id === change.id)!;
        const unchanged =
          before.modality === values.modality && before.sundayWeight === values.sundayWeight && before.holidayWeight === values.holidayWeight;
        if (unchanged) return toPolicyDto(before, establishmentId);
        const after = await updatePolicy(tx, tenantId, change.id, values);
        await audit(after.id, 'alteracao', before, after);
        return toPolicyDto(after, establishmentId);
      }

      if (change.closePrevious) {
        const before = rows.find((r) => r.id === change.closePrevious!.id)!;
        const after = await updatePolicy(tx, tenantId, before.id, { validTo: change.closePrevious.validTo });
        await audit(after.id, 'alteracao', before, after);
      }
      const created = await insertPolicy(tx, { tenantId, establishmentId, ...values, validFrom: body.validFrom, validTo: change.validTo });
      await audit(created.id, 'criacao', null, created);
      return toPolicyDto(created, establishmentId);
    });
  }

  /** 404 se o estabelecimento não for da conta ou estiver fora do escopo do usuário. */
  private async establishmentInScope(ex: Executor, ctx: RequestContext, establishmentId: number, lock = false) {
    const row = await findEstablishment(ex, tenantOf(ctx), establishmentId, lock);
    if (!row || !establishmentInScope(ctx, establishmentId)) throw notFound('Estabelecimento');
    return row;
  }

  private today(uf: string): CivilDate {
    return toCivilDate(this.d.clock.now(), timezoneForUf(uf));
  }
}

function toPolicyDto(row: PolicyRow, establishmentId: number): PolicyDto {
  return {
    id: row.id,
    establishmentId,
    modality: row.modality as TimeBankModality,
    sundayWeight: row.sundayWeight,
    holidayWeight: row.holidayWeight,
    validFrom: row.validFrom,
    validTo: row.validTo,
  };
}
