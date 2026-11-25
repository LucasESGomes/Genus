/**
 * Acessos entre contas: sessões, tentativas de login, IPs sinalizados e revogação.
 *
 * Cada leitura grava UMA linha `leitura_sensivel` (entidade `access_log`) com os filtros em `dados_depois`.
 * Revogar sessão grava `exclusao` de `session` com motivo, na mesma transação do DELETE.
 * [A CONFIRMAR] O super_admin pode revogar a PRÓPRIA sessão (a próxima requisição dele cai em 401);
 * o painel deve avisar antes. Não há bloqueio no back.
 */
import type { z } from 'zod';
import type { Database } from '../../../db/client';
import { HttpError } from '../../../plugins/error-handler';
import type { RequestContext } from '../../../plugins/request-context';
import { recordAudit } from '../../audit/audit';
import { auditTenantId } from '../audit-tenant';
import type { flaggedIpDto, listLoginAttemptsQuery, listSessionsQuery, loginAttemptDto, sessionDto, StatsWindow } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { resolvePeriod } from '../period';
import { AccessLogRepository } from './repository';
import { FLAG_ACCOUNTS_WINDOW_MINUTES, FLAG_FAILURES_WINDOW_MINUTES, FLAGGED_IPS_LIMIT, flagIps } from './rules/flag-ips';

type SessionQuery = z.infer<typeof listSessionsQuery>;
type AttemptQuery = z.infer<typeof listLoginAttemptsQuery>;
type SessionDto = z.infer<typeof sessionDto>;
type AttemptDto = z.infer<typeof loginAttemptDto>;
type FlaggedDto = z.infer<typeof flaggedIpDto>;

const WINDOW_MS: Record<StatsWindow, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };
/** Linhas lidas do banco antes de ordenar por sinalização e cortar em 200. */
const AGGREGATE_CAP = 1000;

export class AccessLogService {
  private readonly repo: AccessLogRepository;

  constructor(private readonly d: Pick<SuperAdminDeps, 'db' | 'clock'>) {
    this.repo = new AccessLogRepository(d.db);
  }

  private get db(): Database {
    return this.d.db;
  }

  private async audit(ctx: RequestContext, tenantId: number | undefined, after: Record<string, unknown>): Promise<void> {
    return recordAudit(this.db, this.d.clock, {
      tenantId: await auditTenantId(this.db, tenantId),
      userId: ctx.userId,
      entity: 'access_log',
      entityId: tenantId ?? 0,
      action: 'leitura_sensivel',
      after,
    });
  }

  async listSessions(ctx: RequestContext, q: SessionQuery): Promise<{ data: SessionDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const now = this.d.clock.now();
    const { rows, total } = await this.repo.listSessions({ tenantId: q.tenantId, userId: q.userId, ip: q.ip, active: q.active, now }, q.page, q.pageSize);
    await this.audit(ctx, q.tenantId, { view: 'sessions', tenantId: q.tenantId, userId: q.userId, ip: q.ip, active: q.active, page: q.page, pageSize: q.pageSize });
    return {
      data: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        userId: r.userId,
        userEmail: r.userEmail,
        role: r.role,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        isActive: r.expiresAt.getTime() > now.getTime(),
      })),
      meta: { page: q.page, pageSize: q.pageSize, total },
    };
  }

  async listLoginAttempts(ctx: RequestContext, q: AttemptQuery): Promise<{ data: AttemptDto[]; meta: { nextCursor: number | null; limit: number } }> {
    const period = resolvePeriod(this.d.clock.now(), q.from, q.to);
    const rows = await this.repo.listAttempts({ ip: q.ip, tenantId: q.tenantId, success: q.success, ...period, cursor: q.cursor, limit: q.limit });
    await this.audit(ctx, q.tenantId, { view: 'login_attempts', tenantId: q.tenantId, ip: q.ip, success: q.success, from: period.from, to: period.to, limit: q.limit, cursor: q.cursor });
    const last = rows[rows.length - 1];
    return {
      data: rows.map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        step: r.step as AttemptDto['step'],
        success: r.isSuccess,
        failureReason: r.failureReason as AttemptDto['failureReason'],
        createdAt: r.createdAt.toISOString(),
      })),
      meta: { nextCursor: rows.length === q.limit && last ? last.id : null, limit: q.limit },
    };
  }

  async flaggedIps(ctx: RequestContext, window: StatsWindow): Promise<FlaggedDto[]> {
    const now = this.d.clock.now();
    const rows = await this.repo.aggregateByIp(
      new Date(now.getTime() - WINDOW_MS[window]),
      { failuresSince: new Date(now.getTime() - FLAG_FAILURES_WINDOW_MINUTES * 60_000), accountsSince: new Date(now.getTime() - FLAG_ACCOUNTS_WINDOW_MINUTES * 60_000) },
      AGGREGATE_CAP,
    );
    await this.audit(ctx, undefined, { view: 'flagged_ips', window });
    return flagIps(rows, undefined, FLAGGED_IPS_LIMIT).map((r) => ({
      ipAddress: r.ipAddress,
      failures: r.failures,
      successes: r.successes,
      distinctAccounts: r.distinctAccounts,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      flagged: r.flagged,
      reasons: r.reasons,
    }));
  }

  async revokeSession(ctx: RequestContext, sessionId: number, reason: string): Promise<{ revoked: number }> {
    return this.db.transaction(async (tx) => {
      const session = await this.repo.findSession(tx, sessionId);
      if (!session) throw new HttpError(404, 'NOT_FOUND', 'Sessão não encontrada');
      const revoked = await this.repo.deleteSession(tx, sessionId);
      await recordAudit(tx, this.d.clock, {
        tenantId: session.tenantId,
        userId: ctx.userId,
        entity: 'session',
        entityId: sessionId,
        action: 'exclusao',
        before: { userId: session.userId },
        reason,
      });
      return { revoked };
    });
  }

  async revokeUserSessions(ctx: RequestContext, userId: number, reason: string): Promise<{ revoked: number }> {
    return this.db.transaction(async (tx) => {
      const user = await this.repo.findUser(tx, userId);
      if (!user) throw new HttpError(404, 'NOT_FOUND', 'Usuário não encontrado');
      const revoked = await this.repo.deleteUserSessions(tx, userId);
      await recordAudit(tx, this.d.clock, {
        tenantId: user.tenantId,
        userId: ctx.userId,
        entity: 'session',
        entityId: userId,
        action: 'exclusao',
        before: { userId },
        after: { revoked },
        reason,
      });
      return { revoked };
    });
  }
}
