/**
 * Ajuste de marcação (G5, RF23 a RF26). O RH (ou o colaborador, pelo portal)
 * pede; o RH decide, ou o gestor da equipe quando o módulo de gestor está
 * ligado. Nunca altera a marcação original: o ajuste aprovado entra na
 * apuração como marcação `tratada` (RN01, Portaria 671 art. 74).
 *
 * - Período fechado: o trigger trg_ajuste_periodo_fechado recusa (409 PERIODO_FECHADO).
 * - Quem pediu não decide (CHECK ajuste_decisor_diferente → 409 DECISOR_IGUAL_SOLICITANTE).
 * - Abono é só do RH (04 G5).
 * - Aprovar recalcula o dia na mesma transação.
 */
import type { Clock } from '@genus/shared';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { ArpPunchReader } from '../../arp/punch-reader';
import type { Database } from '../../db/client';
import { containsAny } from '../../http/search';
import { employees, timeAdjustments } from '../../db/schema';
import { employeeScopeConditions, notFound, tenantOf } from '../../http/access';
import { HttpError } from '../../plugins/error-handler';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import { assertPeriodOpen } from '../closing/period-lock';
import { findEmployeeInScope } from '../employees/lookup';
import { TimesheetService } from '../timesheets/service';
import type { adjustmentDto, createAdjustmentBody, listAdjustmentsQuery } from './schemas';

type AdjustmentDto = z.infer<typeof adjustmentDto>;
type Row = typeof timeAdjustments.$inferSelect;

function toDto(r: Row): AdjustmentDto {
  return {
    id: r.id,
    employeeId: r.employeeId,
    date: r.date,
    type: r.type as AdjustmentDto['type'],
    proposedAt: r.proposedAt?.toISOString() ?? null,
    reason: r.reason,
    status: r.status as AdjustmentDto['status'],
    requestedById: r.requestedById,
    requestedAt: r.requestedAt.toISOString(),
    decidedById: r.decidedById,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionReason: r.decisionReason,
  };
}

export interface AdjustmentServiceDeps {
  db: Database;
  clock: Clock;
  arp: ArpPunchReader;
}

export class AdjustmentService {
  private readonly timesheets: TimesheetService;

  constructor(private readonly d: AdjustmentServiceDeps) {
    this.timesheets = new TimesheetService(d);
  }

  async create(ctx: RequestContext, employeeId: number, body: z.infer<typeof createAdjustmentBody>): Promise<AdjustmentDto> {
    const emp = await findEmployeeInScope(this.d.db, ctx, employeeId);
    const row = await this.d.db.transaction(async (tx) => {
      await assertPeriodOpen(tx, emp.id, body.date);
      const [created] = await tx
        .insert(timeAdjustments)
        .values({
          tenantId: emp.tenantId,
          employeeId: emp.id,
          date: body.date,
          type: body.type,
          proposedAt: body.proposedAt ? new Date(body.proposedAt) : null,
          reason: body.reason,
          requestedById: ctx.userId,
          requestedAt: this.d.clock.now(),
        })
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId: emp.tenantId,
        userId: ctx.userId,
        entity: 'ajustes',
        entityId: created!.id,
        action: 'criacao',
        after: { date: body.date, type: body.type, proposedAt: body.proposedAt ?? null },
      });
      return created!;
    });
    return toDto(row);
  }

  async list(ctx: RequestContext, q: z.infer<typeof listAdjustmentsQuery>) {
    const conds: SQL[] = [...employeeScopeConditions(ctx), eq(timeAdjustments.tenantId, tenantOf(ctx))];
    if (q.status) conds.push(eq(timeAdjustments.status, q.status));
    if (q.employeeId) conds.push(eq(timeAdjustments.employeeId, q.employeeId));
    if (q.q) conds.push(containsAny([employees.name, employees.registrationNumber], q.q));
    const where = and(...conds);
    const join = and(eq(employees.tenantId, timeAdjustments.tenantId), eq(employees.id, timeAdjustments.employeeId));
    const [rows, [total]] = await Promise.all([
      this.d.db
        .select({ a: timeAdjustments })
        .from(timeAdjustments)
        .innerJoin(employees, join)
        .where(where)
        .orderBy(desc(timeAdjustments.requestedAt), desc(timeAdjustments.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.d.db.select({ n: count() }).from(timeAdjustments).innerJoin(employees, join).where(where),
    ]);
    return { data: rows.map((r) => toDto(r.a)), meta: { page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 } };
  }

  async decide(ctx: RequestContext, id: number, decision: { approve: true; note?: string } | { approve: false; reason: string }): Promise<AdjustmentDto> {
    const tenantId = tenantOf(ctx);
    const [current] = await this.d.db
      .select()
      .from(timeAdjustments)
      .where(and(eq(timeAdjustments.tenantId, tenantId), eq(timeAdjustments.id, id)))
      .limit(1);
    if (!current) throw notFound('Ajuste');
    const emp = await findEmployeeInScope(this.d.db, ctx, current.employeeId).catch(() => {
      throw notFound('Ajuste');
    });
    if (ctx.role === 'gestor' && current.type === 'abono') {
      throw new HttpError(403, 'FORBIDDEN', 'Abono é decidido só pelo RH');
    }

    const row = await this.d.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ status: timeAdjustments.status })
        .from(timeAdjustments)
        .where(and(eq(timeAdjustments.tenantId, tenantId), eq(timeAdjustments.id, id)))
        .for('update');
      if (locked!.status !== 'pendente') throw new HttpError(409, 'STATUS_INVALIDO', 'O ajuste já foi decidido');
      await assertPeriodOpen(tx, emp.id, current.date);
      const [after] = await tx
        .update(timeAdjustments)
        .set({
          status: decision.approve ? 'aprovado' : 'recusado',
          decidedById: ctx.userId,
          decidedAt: this.d.clock.now(),
          decisionReason: decision.approve ? (decision.note ?? null) : decision.reason,
        })
        .where(and(eq(timeAdjustments.tenantId, tenantId), eq(timeAdjustments.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'ajustes',
        entityId: id,
        action: decision.approve ? 'aprovacao' : 'recusa',
        before: { status: 'pendente' },
        after: { status: after!.status },
        reason: after!.decisionReason,
      });
      // RF25: a marcação tratada entra na apuração do dia
      if (decision.approve && current.type === 'inclusao_batida') {
        await this.timesheets.recalculateIn(tx, emp, current.date, current.date);
      }
      return after!;
    });
    return toDto(row);
  }
}
