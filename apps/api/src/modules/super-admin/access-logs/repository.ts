/** Sessões e tentativas de login entre contas. Nada daqui devolve token, e-mail em claro nem `email_hash`. */
import { and, count, countDistinct, desc, eq, gt, gte, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../../../db/client';
import type { Executor } from '../../../db/executor';
import { loginAttempts, sessions, tenants, users } from '../../../db/schema';
import type { IpAggregate } from './rules/flag-ips';

export interface SessionFilter {
  tenantId?: number | undefined;
  userId?: number | undefined;
  ip?: string | undefined;
  active?: boolean | undefined;
  now: Date;
}

export interface AttemptFilter {
  ip?: string | undefined;
  tenantId?: number | undefined;
  success?: boolean | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: number | undefined;
  limit: number;
}

export interface RecentWindows {
  /** Início da janela de falhas recentes (15 min antes do agora). */
  failuresSince: Date;
  /** Início da janela de contas distintas (1 h antes do agora). */
  accountsSince: Date;
}

export class AccessLogRepository {
  constructor(private readonly db: Database) {}

  private sessionWhere(f: SessionFilter) {
    return and(
      f.tenantId === undefined ? undefined : eq(sessions.tenantId, f.tenantId),
      f.userId === undefined ? undefined : eq(sessions.userId, f.userId),
      f.ip === undefined ? undefined : eq(sessions.ipAddress, f.ip),
      f.active === undefined ? undefined : f.active ? gt(sessions.expiresAt, f.now) : lte(sessions.expiresAt, f.now),
    );
  }

  /** O token da sessão nunca é selecionado. */
  async listSessions(f: SessionFilter, page: number, pageSize: number) {
    const where = this.sessionWhere(f);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({
          id: sessions.id,
          tenantId: sessions.tenantId,
          tenantName: tenants.name,
          userId: sessions.userId,
          userEmail: users.email,
          role: users.role,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .leftJoin(tenants, eq(tenants.id, sessions.tenantId))
        .where(where)
        .orderBy(desc(sessions.createdAt), desc(sessions.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ n: count() }).from(sessions).where(where),
    ]);
    return { rows, total: total?.n ?? 0 };
  }

  async listAttempts(f: AttemptFilter) {
    return this.db
      .select({
        id: loginAttempts.id,
        tenantId: loginAttempts.tenantId,
        userId: loginAttempts.userId,
        ipAddress: loginAttempts.ipAddress,
        userAgent: loginAttempts.userAgent,
        step: loginAttempts.step,
        isSuccess: loginAttempts.isSuccess,
        failureReason: loginAttempts.failureReason,
        createdAt: loginAttempts.createdAt,
      })
      .from(loginAttempts)
      .where(
        and(
          f.ip === undefined ? undefined : eq(loginAttempts.ipAddress, f.ip),
          f.tenantId === undefined ? undefined : eq(loginAttempts.tenantId, f.tenantId),
          f.success === undefined ? undefined : eq(loginAttempts.isSuccess, f.success),
          f.from === undefined ? undefined : gte(loginAttempts.createdAt, f.from),
          f.to === undefined ? undefined : lt(loginAttempts.createdAt, f.to),
          f.cursor === undefined ? undefined : lt(loginAttempts.id, f.cursor),
        ),
      )
      .orderBy(desc(loginAttempts.id))
      .limit(f.limit);
  }

  /** Agregado por IP na janela [since, now). Só IPs com ao menos uma falha; no máximo `cap` linhas (mais falhas primeiro). */
  async aggregateByIp(since: Date, recent: RecentWindows, cap: number): Promise<IpAggregate[]> {
    const failed = sql`${loginAttempts.isSuccess} = false`;
    const rows = await this.db
      .select({
        ipAddress: loginAttempts.ipAddress,
        failures: sql<number>`(count(*) filter (where ${failed}))::int`,
        successes: sql<number>`(count(*) filter (where ${loginAttempts.isSuccess}))::int`,
        distinctAccounts: countDistinct(loginAttempts.emailHash),
        firstSeenAt: sql<Date>`min(${loginAttempts.createdAt})`.mapWith(loginAttempts.createdAt),
        lastSeenAt: sql<Date>`max(${loginAttempts.createdAt})`.mapWith(loginAttempts.createdAt),
        recentFailures: sql<number>`(count(*) filter (where ${failed} and ${loginAttempts.createdAt} >= ${recent.failuresSince}))::int`,
        recentDistinctAccounts: sql<number>`(count(distinct ${loginAttempts.emailHash}) filter (where ${loginAttempts.createdAt} >= ${recent.accountsSince}))::int`,
      })
      .from(loginAttempts)
      .where(and(gte(loginAttempts.createdAt, since), isNotNull(loginAttempts.ipAddress)))
      .groupBy(loginAttempts.ipAddress)
      .having(sql`count(*) filter (where ${failed}) >= 1`)
      .orderBy(sql`count(*) filter (where ${failed}) desc`)
      .limit(cap);
    return rows.map((r) => ({ ...r, ipAddress: r.ipAddress!, failures: Number(r.failures), successes: Number(r.successes), distinctAccounts: Number(r.distinctAccounts) }));
  }

  async findSession(ex: Executor, sessionId: number) {
    const [row] = await ex.select({ id: sessions.id, tenantId: sessions.tenantId, userId: sessions.userId }).from(sessions).where(eq(sessions.id, sessionId)).limit(1);
    return row;
  }

  async deleteSession(ex: Executor, sessionId: number): Promise<number> {
    const rows = await ex.delete(sessions).where(eq(sessions.id, sessionId)).returning({ id: sessions.id });
    return rows.length;
  }

  async findUser(ex: Executor, userId: number) {
    const [row] = await ex.select({ id: users.id, tenantId: users.tenantId }).from(users).where(eq(users.id, userId)).limit(1);
    return row;
  }

  async deleteUserSessions(ex: Executor, userId: number): Promise<number> {
    const rows = await ex.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
    return rows.length;
  }
}
