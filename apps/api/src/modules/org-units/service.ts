/**
 * Setores, cargos e centros de custo (G1, RF02). Sem DELETE: a linha pode estar
 * num vínculo (`vinculos_colaborador`), e o histórico do vínculo não pode
 * perder a referência. Nome repetido: a UNIQUE do banco responde 409
 * (`http/domain-errors.ts`).
 */
import type { Clock } from '@genus/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import { costCenters, departments, establishments, jobTitles } from '../../db/schema';
import { establishmentInScope, notFound, tenantOf } from '../../http/access';
import type { RequestContext } from '../../plugins/request-context';
import { recordAudit } from '../audit/audit';
import type {
  CostCenterDto,
  createCostCenterBody,
  createDepartmentBody,
  createJobTitleBody,
  DepartmentDto,
  JobTitleDto,
  updateCostCenterBody,
  updateDepartmentBody,
  updateJobTitleBody,
} from './schemas';

export interface OrgUnitServiceDeps {
  db: Database;
  clock: Clock;
}

const department = (r: typeof departments.$inferSelect): DepartmentDto => ({
  id: Number(r.id),
  establishmentId: Number(r.establishmentId),
  name: r.name,
  maxSimultaneousVacations: r.maxSimultaneousVacations,
});
const jobTitle = (r: typeof jobTitles.$inferSelect): JobTitleDto => ({ id: Number(r.id), companyId: Number(r.companyId), name: r.name, cbo: r.cbo });
const costCenter = (r: typeof costCenters.$inferSelect): CostCenterDto => ({ id: Number(r.id), companyId: Number(r.companyId), code: r.code, name: r.name });

export class OrgUnitService {
  constructor(private readonly d: OrgUnitServiceDeps) {}

  /** Estabelecimento da conta e do escopo; fora dele, 404 (não confirma que existe). */
  private async establishment(ctx: RequestContext, establishmentId: number) {
    const [est] = await this.d.db
      .select({ id: establishments.id, companyId: establishments.companyId })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantOf(ctx)), eq(establishments.id, establishmentId)))
      .limit(1);
    if (!est || !establishmentInScope(ctx, Number(est.id))) throw notFound('Estabelecimento');
    return { id: Number(est.id), companyId: Number(est.companyId) };
  }

  /** A empresa tem algum estabelecimento no escopo do usuário? (cargo e centro de custo são da empresa) */
  private async companyInScope(ctx: RequestContext, companyId: number): Promise<boolean> {
    if (ctx.establishmentScope === null) return true;
    if (ctx.establishmentScope.length === 0) return false;
    const [row] = await this.d.db
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.tenantId, tenantOf(ctx)), eq(establishments.companyId, companyId), inArray(establishments.id, ctx.establishmentScope)))
      .limit(1);
    return !!row;
  }

  // ------------------------------------------------------------------ setores

  async listDepartments(ctx: RequestContext, establishmentId: number): Promise<DepartmentDto[]> {
    const est = await this.establishment(ctx, establishmentId);
    const rows = await this.d.db
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, tenantOf(ctx)), eq(departments.establishmentId, est.id)))
      .orderBy(asc(departments.name));
    return rows.map(department);
  }

  async createDepartment(ctx: RequestContext, body: z.infer<typeof createDepartmentBody>): Promise<DepartmentDto> {
    const tenantId = tenantOf(ctx);
    const est = await this.establishment(ctx, body.establishmentId);
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(departments)
        .values({ tenantId, establishmentId: est.id, name: body.name, maxSimultaneousVacations: body.maxSimultaneousVacations })
        .returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'setores', entityId: Number(row!.id), action: 'criacao', after: body });
      return department(row!);
    });
  }

  async updateDepartment(ctx: RequestContext, id: number, body: z.infer<typeof updateDepartmentBody>): Promise<DepartmentDto> {
    const tenantId = tenantOf(ctx);
    const [before] = await this.d.db
      .select()
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.id, id)))
      .limit(1);
    if (!before || !establishmentInScope(ctx, Number(before.establishmentId))) throw notFound('Setor');
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .update(departments)
        .set(body)
        .where(and(eq(departments.tenantId, tenantId), eq(departments.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'setores',
        entityId: id,
        action: 'alteracao',
        before: { name: before.name, maxSimultaneousVacations: before.maxSimultaneousVacations },
        after: body,
      });
      return department(row!);
    });
  }

  // ------------------------------------------------------------------ cargos

  async listJobTitles(ctx: RequestContext, establishmentId: number): Promise<JobTitleDto[]> {
    const est = await this.establishment(ctx, establishmentId);
    const rows = await this.d.db
      .select()
      .from(jobTitles)
      .where(and(eq(jobTitles.tenantId, tenantOf(ctx)), eq(jobTitles.companyId, est.companyId)))
      .orderBy(asc(jobTitles.name));
    return rows.map(jobTitle);
  }

  async createJobTitle(ctx: RequestContext, body: z.infer<typeof createJobTitleBody>): Promise<JobTitleDto> {
    const tenantId = tenantOf(ctx);
    const est = await this.establishment(ctx, body.establishmentId);
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(jobTitles)
        .values({ tenantId, companyId: est.companyId, name: body.name, cbo: body.cbo ?? null })
        .returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'cargos', entityId: Number(row!.id), action: 'criacao', after: body });
      return jobTitle(row!);
    });
  }

  async updateJobTitle(ctx: RequestContext, id: number, body: z.infer<typeof updateJobTitleBody>): Promise<JobTitleDto> {
    const tenantId = tenantOf(ctx);
    const [before] = await this.d.db
      .select()
      .from(jobTitles)
      .where(and(eq(jobTitles.tenantId, tenantId), eq(jobTitles.id, id)))
      .limit(1);
    if (!before || !(await this.companyInScope(ctx, Number(before.companyId)))) throw notFound('Cargo');
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .update(jobTitles)
        .set(body)
        .where(and(eq(jobTitles.tenantId, tenantId), eq(jobTitles.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'cargos',
        entityId: id,
        action: 'alteracao',
        before: { name: before.name, cbo: before.cbo },
        after: body,
      });
      return jobTitle(row!);
    });
  }

  // ------------------------------------------------------------------ centros de custo

  async listCostCenters(ctx: RequestContext, establishmentId: number): Promise<CostCenterDto[]> {
    const est = await this.establishment(ctx, establishmentId);
    const rows = await this.d.db
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.tenantId, tenantOf(ctx)), eq(costCenters.companyId, est.companyId)))
      .orderBy(asc(costCenters.code));
    return rows.map(costCenter);
  }

  async createCostCenter(ctx: RequestContext, body: z.infer<typeof createCostCenterBody>): Promise<CostCenterDto> {
    const tenantId = tenantOf(ctx);
    const est = await this.establishment(ctx, body.establishmentId);
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx.insert(costCenters).values({ tenantId, companyId: est.companyId, code: body.code, name: body.name }).returning();
      await recordAudit(tx, this.d.clock, { tenantId, userId: ctx.userId, entity: 'centros_custo', entityId: Number(row!.id), action: 'criacao', after: body });
      return costCenter(row!);
    });
  }

  async updateCostCenter(ctx: RequestContext, id: number, body: z.infer<typeof updateCostCenterBody>): Promise<CostCenterDto> {
    const tenantId = tenantOf(ctx);
    const [before] = await this.d.db
      .select()
      .from(costCenters)
      .where(and(eq(costCenters.tenantId, tenantId), eq(costCenters.id, id)))
      .limit(1);
    if (!before || !(await this.companyInScope(ctx, Number(before.companyId)))) throw notFound('Centro de custo');
    return this.d.db.transaction(async (tx) => {
      const [row] = await tx
        .update(costCenters)
        .set(body)
        .where(and(eq(costCenters.tenantId, tenantId), eq(costCenters.id, id)))
        .returning();
      await recordAudit(tx, this.d.clock, {
        tenantId,
        userId: ctx.userId,
        entity: 'centros_custo',
        entityId: id,
        action: 'alteracao',
        before: { code: before.code, name: before.name },
        after: body,
      });
      return costCenter(row!);
    });
  }
}
