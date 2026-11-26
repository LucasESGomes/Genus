/**
 * Convites de usuário (magic link com confirmação de CPF). Um só service para as duas portas: o admin
 * da conta (`/portal/invites`) e o super_admin (`/portal/super-admin/tenants/:tenantId/invites`).
 *
 * Segurança: o aceite não recebe conta, papel, nome nem e-mail; tudo sai da linha do convite. O usuário
 * nasce na mesma transação que marca o convite, com a linha travada (uso único). Token inexistente,
 * expirado, usado, revogado ou de conta suspensa dão a mesma resposta (404 `CONVITE_INVALIDO`).
 * CPF, token e hashes nunca entram em log, auditoria ou erro.
 */
import type { Clock } from '@genus/shared';
import { z } from 'zod';
import type { Database } from '../../db/client';
import type { Transaction } from '../../db/executor';
import { notFound } from '../../http/access';
import { HttpError, pgError } from '../../plugins/error-handler';
import { recordAudit, type AuditEntry } from '../audit/audit';
import { UserService } from '../auth/user-service';
import { isValidCpf, normalizeCpf } from '../employees/rules/cpf';
import { generateInviteToken, hashInviteCpf, hashInviteToken, sameDigest } from './crypto';
import { InviteRepository, type InviteRow } from './repository';
import { INVITE_ROLES, inviteExpiresAt, inviteStatus, maskEmail, MAX_CPF_ATTEMPTS, type InviteRole } from './rules/invite';
import type { acceptInviteBody, createInviteBody, InviteDto } from './schemas';

export interface InviteServiceDeps {
  db: Database;
  clock: Clock;
  /** Chave do HMAC do CPF (`deriveInviteCpfKey`). */
  cpfHashKey: Buffer;
}

/** Quem convida ou revoga. `tenantId` vem da sessão (admin) ou da rota (super_admin), nunca do corpo. */
export interface InviteActor {
  tenantId: number;
  userId: number;
}

const roleSchema = z.enum(INVITE_ROLES);

export const invalidInvite = () => new HttpError(404, 'CONVITE_INVALIDO', 'Convite inválido ou expirado. Peça um novo convite');
const cpfMismatch = () => new HttpError(400, 'CPF_NAO_CONFERE', 'O CPF não confere com o convite');
const emailInUse = () => new HttpError(409, 'EMAIL_IN_USE', 'Já existe um usuário com esse e-mail na plataforma');

function toDto(row: InviteRow, now: Date): InviteDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: roleSchema.parse(row.role),
    status: inviteStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

export class InviteService {
  private readonly users: UserService;

  constructor(
    private readonly d: InviteServiceDeps,
    private readonly repo = new InviteRepository(),
  ) {
    this.users = new UserService({ db: d.db });
  }

  async list(tenantId: number): Promise<InviteDto[]> {
    await this.assertTenant(tenantId);
    const rows = await this.repo.list(this.d.db, tenantId);
    const now = this.d.clock.now();
    return rows.map((r) => toDto(r, now));
  }

  async create(actor: InviteActor, body: z.infer<typeof createInviteBody>): Promise<{ invite: InviteDto; token: string }> {
    const cpf = normalizeCpf(body.cpf);
    if (!isValidCpf(cpf)) throw new HttpError(400, 'CPF_INVALIDO', 'CPF inválido', [{ path: 'cpf', message: 'dígito verificador não confere' }]);
    await this.assertTenant(actor.tenantId);

    const { token, tokenHash } = generateInviteToken();
    const now = this.d.clock.now();
    const row = await this.d.db.transaction(async (tx) => {
      if (await this.repo.emailExists(tx, body.email)) throw emailInUse();
      // Um pendente por (conta, e-mail): o anterior deixa de valer, mesmo já vencido.
      for (const id of await this.repo.revokePendingByEmail(tx, actor.tenantId, body.email)) {
        await this.audit(tx, { ...actor, entityId: id, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'revogado' } });
      }
      const created = await this.repo.insert(tx, {
        tenantId: actor.tenantId,
        email: body.email,
        name: body.name,
        role: body.role,
        cpfHash: hashInviteCpf(this.d.cpfHashKey, cpf),
        tokenHash,
        expiresAt: inviteExpiresAt(now),
        createdById: actor.userId,
        createdAt: now,
      });
      await this.audit(tx, { ...actor, entityId: created.id, action: 'criacao', after: { role: body.role, expiresAt: created.expiresAt } });
      return created;
    });
    return { invite: toDto(row, now), token };
  }

  /** Revogar de novo não muda nada; convite aceito não se revoga (o usuário já existe). */
  async revoke(actor: InviteActor, inviteId: number): Promise<InviteDto> {
    const row = await this.d.db.transaction(async (tx) => {
      const current = await this.repo.getForUpdate(tx, actor.tenantId, inviteId);
      if (!current) throw notFound('Convite');
      if (current.status === 'aceito') throw new HttpError(409, 'CONFLICT', 'O convite já foi aceito e não pode ser revogado');
      if (current.status === 'revogado') return current;
      const revoked = await this.repo.revoke(tx, actor.tenantId, inviteId);
      await this.audit(tx, { ...actor, entityId: inviteId, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'revogado' } });
      return revoked;
    });
    return toDto(row, this.d.clock.now());
  }

  async preview(token: string): Promise<{ tenantName: string; name: string; emailMasked: string; role: InviteRole; expiresAt: string }> {
    const invite = await this.repo.findPendingByTokenHash(this.d.db, hashInviteToken(token), this.d.clock.now());
    if (!invite) throw invalidInvite();
    const tenantName = await this.repo.activeTenantName(this.d.db, invite.tenantId);
    if (tenantName === undefined) throw invalidInvite();
    return {
      tenantName,
      name: invite.name,
      emailMasked: maskEmail(invite.email),
      role: roleSchema.parse(invite.role),
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async accept(body: z.infer<typeof acceptInviteBody>): Promise<{ email: string }> {
    const cpfHash = hashInviteCpf(this.d.cpfHashKey, normalizeCpf(body.cpf));
    try {
      const outcome = await this.d.db.transaction(async (tx) => {
        const now = this.d.clock.now();
        const invite = await this.repo.findPendingByTokenHash(tx, hashInviteToken(body.token), now, true);
        if (!invite || (await this.repo.activeTenantName(tx, invite.tenantId, true)) === undefined) throw invalidInvite();
        const { tenantId, id: inviteId } = invite;

        if (!sameDigest(invite.cpfHash, cpfHash)) {
          const attempts = invite.attempts + 1;
          const status = attempts >= MAX_CPF_ATTEMPTS ? 'revogado' : 'pendente';
          await this.repo.registerFailure(tx, tenantId, inviteId, attempts, status);
          await this.audit(tx, {
            tenantId,
            userId: null,
            entityId: inviteId,
            action: 'alteracao',
            before: { attempts: invite.attempts, status: 'pendente' },
            after: { attempts, status },
          });
          // Sai sem lançar erro: a transação precisa ser confirmada para a tentativa contar.
          return null;
        }

        if (await this.repo.emailExists(tx, invite.email)) throw emailInUse();
        const role = roleSchema.parse(invite.role);
        const user = await this.users.createUser(
          { tenantId, email: invite.email, name: invite.name, role, employeeId: null, password: body.password },
          tx,
        );
        await this.repo.markAccepted(tx, tenantId, inviteId, user.id, now);
        const by = { tenantId, userId: user.id };
        await this.audit(tx, { ...by, entityId: inviteId, action: 'alteracao', before: { status: 'pendente' }, after: { status: 'aceito' } });
        await recordAudit(tx, this.d.clock, { ...by, entity: 'usuarios', entityId: user.id, action: 'criacao', after: { role, inviteId } });
        return { email: user.email };
      });
      if (!outcome) throw cpfMismatch();
      return outcome;
    } catch (err) {
      // Corrida: o e-mail virou usuário entre a checagem e o INSERT.
      if (pgError(err)?.constraint === 'usuario_email_key') throw emailInUse();
      throw err;
    }
  }

  private async assertTenant(tenantId: number): Promise<void> {
    if (!(await this.repo.tenantExists(this.d.db, tenantId))) throw notFound('Conta');
  }

  private async audit(tx: Transaction, e: Omit<AuditEntry, 'entity'>): Promise<void> {
    await recordAudit(tx, this.d.clock, { ...e, entity: 'user_invite' });
  }
}
