/**
 * Acesso a dados dos convites. Tudo filtra por `conta_id`, menos `findPendingByTokenHash`: nas rotas
 * públicas não há sessão, e a conta sai do próprio convite achado pelo hash do token.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { tenants, userInvites, users } from '../../db/schema';

const columns = {
  id: userInvites.id,
  tenantId: userInvites.tenantId,
  email: userInvites.email,
  name: userInvites.name,
  role: userInvites.role,
  status: userInvites.status,
  attempts: userInvites.attempts,
  expiresAt: userInvites.expiresAt,
  acceptedAt: userInvites.acceptedAt,
  createdAt: userInvites.createdAt,
};

export interface InviteRow {
  id: number;
  tenantId: number;
  email: string;
  name: string;
  role: string;
  status: string;
  attempts: number;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export type NewInvite = Pick<
  typeof userInvites.$inferInsert,
  'tenantId' | 'email' | 'name' | 'role' | 'cpfHash' | 'tokenHash' | 'expiresAt' | 'createdById' | 'createdAt'
>;

const byId = (tenantId: number, inviteId: number) => and(eq(userInvites.tenantId, tenantId), eq(userInvites.id, inviteId));

export class InviteRepository {
  async tenantExists(ex: Executor, tenantId: number): Promise<boolean> {
    const [row] = await ex.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    return row !== undefined;
  }

  /** Nome da conta, só se estiver ativa. `lock`: segura a suspensão até o fim da transação do aceite. */
  async activeTenantName(ex: Executor, tenantId: number, lock = false): Promise<string | undefined> {
    const query = ex
      .select({ name: tenants.name })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), eq(tenants.isActive, true)));
    const [row] = await (lock ? query.for('share') : query);
    return row?.name;
  }

  /** E-mail é único na plataforma inteira (`usuario_email_key`), então a busca não filtra por conta. */
  async emailExists(ex: Executor, email: string): Promise<boolean> {
    const [row] = await ex.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return row !== undefined;
  }

  async list(ex: Executor, tenantId: number): Promise<InviteRow[]> {
    return ex.select(columns).from(userInvites).where(eq(userInvites.tenantId, tenantId)).orderBy(desc(userInvites.createdAt), desc(userInvites.id));
  }

  async getForUpdate(ex: Executor, tenantId: number, inviteId: number): Promise<InviteRow | undefined> {
    const [row] = await ex.select(columns).from(userInvites).where(byId(tenantId, inviteId)).for('update');
    return row;
  }

  /** Convite pendente e no prazo. Com `lock`, quem espera relê a linha já alterada (uso único). */
  async findPendingByTokenHash(ex: Executor, tokenHash: Buffer, now: Date, lock = false): Promise<(InviteRow & { cpfHash: Buffer }) | undefined> {
    const query = ex
      .select({ ...columns, cpfHash: userInvites.cpfHash })
      .from(userInvites)
      .where(and(eq(userInvites.tokenHash, tokenHash), eq(userInvites.status, 'pendente'), gt(userInvites.expiresAt, now)));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }

  async revokePendingByEmail(ex: Executor, tenantId: number, email: string): Promise<number[]> {
    const rows = await ex
      .update(userInvites)
      .set({ status: 'revogado' })
      .where(and(eq(userInvites.tenantId, tenantId), eq(userInvites.email, email), eq(userInvites.status, 'pendente')))
      .returning({ id: userInvites.id });
    return rows.map((r) => r.id);
  }

  async insert(ex: Executor, invite: NewInvite): Promise<InviteRow> {
    const [row] = await ex.insert(userInvites).values(invite).returning(columns);
    return row!;
  }

  async revoke(ex: Executor, tenantId: number, inviteId: number): Promise<InviteRow> {
    const [row] = await ex.update(userInvites).set({ status: 'revogado' }).where(byId(tenantId, inviteId)).returning(columns);
    return row!;
  }

  async registerFailure(ex: Executor, tenantId: number, inviteId: number, attempts: number, status: 'pendente' | 'revogado'): Promise<void> {
    await ex.update(userInvites).set({ attempts, status }).where(byId(tenantId, inviteId));
  }

  async markAccepted(ex: Executor, tenantId: number, inviteId: number, userId: number, at: Date): Promise<void> {
    await ex.update(userInvites).set({ status: 'aceito', acceptedAt: at, userId }).where(byId(tenantId, inviteId));
  }
}
