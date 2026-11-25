/** Leitura da trilha de auditoria entre contas (só o super_admin chega aqui). */
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { Database } from '../../../db/client';
import { auditLogs, tenants, users } from '../../../db/schema';

export interface AuditFilter {
  tenantId?: number | undefined;
  userId?: number | undefined;
  entity?: string | undefined;
  action?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  /** Último `id` visto: devolve só ids menores. */
  cursor?: number | undefined;
  limit: number;
}

const columns = {
  id: auditLogs.id,
  tenantId: auditLogs.tenantId,
  tenantName: tenants.name,
  userId: auditLogs.userId,
  userEmail: users.email,
  entity: auditLogs.entity,
  entityId: auditLogs.entityId,
  action: auditLogs.action,
  reason: auditLogs.reason,
  before: auditLogs.before,
  after: auditLogs.after,
  createdAt: auditLogs.createdAt,
};

export type AuditRow = Awaited<ReturnType<AuditLogRepository['list']>>[number];

export class AuditLogRepository {
  constructor(private readonly db: Database) {}

  private base() {
    return this.db
      .select(columns)
      .from(auditLogs)
      .leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .leftJoin(users, eq(users.id, auditLogs.userId));
  }

  async list(f: AuditFilter) {
    return this.base()
      .where(
        and(
          f.tenantId === undefined ? undefined : eq(auditLogs.tenantId, f.tenantId),
          f.userId === undefined ? undefined : eq(auditLogs.userId, f.userId),
          f.entity === undefined ? undefined : eq(auditLogs.entity, f.entity),
          f.action === undefined ? undefined : eq(auditLogs.action, f.action),
          f.from === undefined ? undefined : gte(auditLogs.createdAt, f.from),
          f.to === undefined ? undefined : lt(auditLogs.createdAt, f.to),
          f.cursor === undefined ? undefined : lt(auditLogs.id, f.cursor),
        ),
      )
      .orderBy(desc(auditLogs.id))
      .limit(f.limit);
  }

  async find(id: number) {
    const [row] = await this.base().where(eq(auditLogs.id, id)).limit(1);
    return row;
  }
}
