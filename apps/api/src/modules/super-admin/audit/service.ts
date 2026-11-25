/**
 * Auditoria entre contas (04 §1.4). Cada leitura grava UMA linha `leitura_sensivel` (entidade `audit_log`)
 * com os filtros em `dados_depois`: quem olhou a auditoria também fica auditado. Nenhum filtro leva e-mail.
 * No detalhe, `entidade_id` é o id da linha lida e `conta_id` a conta dela.
 */
import { z } from 'zod';
import { HttpError } from '../../../plugins/error-handler';
import type { RequestContext } from '../../../plugins/request-context';
import { recordAudit, redactAudit } from '../../audit/audit';
import type { auditLogDetailDto, auditLogDto, listAuditQuery } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { resolvePeriod } from '../period';
import { AuditLogRepository, type AuditRow } from './repository';

type Query = z.infer<typeof listAuditQuery>;
type LogDto = z.infer<typeof auditLogDto>;
type DetailDto = z.infer<typeof auditLogDetailDto>;

function toDto(r: AuditRow): LogDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    userId: r.userId,
    userEmail: r.userEmail,
    entity: r.entity,
    entityId: r.entityId,
    action: r.action,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  };
}

export class SuperAdminAuditService {
  private readonly repo: AuditLogRepository;

  constructor(private readonly d: Pick<SuperAdminDeps, 'db' | 'clock'>) {
    this.repo = new AuditLogRepository(d.db);
  }

  async list(ctx: RequestContext, q: Query): Promise<{ data: LogDto[]; meta: { nextCursor: number | null; limit: number } }> {
    const period = resolvePeriod(this.d.clock.now(), q.from, q.to);
    const rows = await this.repo.list({ tenantId: q.tenantId, userId: q.userId, entity: q.entity, action: q.action, ...period, cursor: q.cursor, limit: q.limit });
    await recordAudit(this.d.db, this.d.clock, {
      tenantId: q.tenantId ?? null,
      userId: ctx.userId,
      entity: 'audit_log',
      entityId: q.tenantId ?? 0,
      action: 'leitura_sensivel',
      after: {
        tenantId: q.tenantId,
        userId: q.userId,
        entity: q.entity,
        action: q.action,
        from: period.from,
        to: period.to,
        limit: q.limit,
        cursor: q.cursor,
      },
    });
    const last = rows[rows.length - 1];
    return { data: rows.map(toDto), meta: { nextCursor: rows.length === q.limit && last ? last.id : null, limit: q.limit } };
  }

  async get(ctx: RequestContext, id: number): Promise<DetailDto> {
    const row = await this.repo.find(id);
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Registro de auditoria não encontrado');
    await recordAudit(this.d.db, this.d.clock, {
      tenantId: row.tenantId,
      userId: ctx.userId,
      entity: 'audit_log',
      entityId: row.id,
      action: 'leitura_sensivel',
    });
    // Já gravados redigidos; redige de novo por garantia (linha antiga ou gravada por outro caminho).
    return {
      ...toDto(row),
      before: redactAudit(row.before as Record<string, unknown> | null),
      after: redactAudit(row.after as Record<string, unknown> | null),
    };
  }
}
