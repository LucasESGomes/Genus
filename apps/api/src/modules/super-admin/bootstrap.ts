/**
 * super_admin da plataforma a partir do ambiente (SUPER_ADMIN_*), na partida da api. Idempotente:
 * criar na primeira vez, atualizar nome e senha se o .env mudou, não fazer nada se está igual.
 *
 * Nunca promove: se o e-mail do .env já pertence a outro papel, só registra o erro. A senha, o hash e o
 * e-mail não vão para log; a auditoria (tenantId e userId nulos) não guarda segredo.
 */
import type { Clock, Logger } from '@genus/shared';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import type { SuperAdminConfig } from '../../config/env';
import type { Database } from '../../db/client';
import { loginCredentials, users } from '../../db/schema';
import { recordAudit } from '../audit/audit';
import { UserService } from '../auth/user-service';

export interface BootstrapSuperAdminOptions {
  db: Database;
  clock: Clock;
  logger: Logger;
  config: SuperAdminConfig | null;
  appEnv: string;
}

export type BootstrapResult = 'created' | 'updated' | 'unchanged' | 'skipped' | 'refused';

export async function bootstrapSuperAdmin(o: BootstrapSuperAdminOptions): Promise<BootstrapResult> {
  const { db, clock, logger, config } = o;
  if (!config) {
    logger.warn('super_admin: SUPER_ADMIN_* ausentes; nenhum super_admin criado');
    return 'skipped';
  }

  const [existing] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.email, config.email)).limit(1);

  if (!existing) {
    const service = new UserService({ db });
    const input = { tenantId: null, email: config.email, name: config.name, role: 'super_admin' as const, employeeId: null };
    const created =
      config.password.kind === 'hash'
        ? await service.createUserWithHash(input, config.password.value)
        : await service.createUser({ ...input, password: config.password.value });
    await db.transaction((tx) =>
      recordAudit(tx, clock, { tenantId: null, userId: null, entity: 'super_admin', entityId: created.id, action: 'criacao', after: { name: config.name, role: 'super_admin' } }),
    );
    logger.info({ userId: created.id, appEnv: o.appEnv }, 'super_admin: criado a partir do ambiente');
    return 'created';
  }

  if (existing.role !== 'super_admin') {
    logger.error('super_admin: e-mail do .env pertence a outro papel; nada foi alterado');
    return 'refused';
  }

  const userId = Number(existing.id);
  const [credential] = await db
    .select({ id: loginCredentials.id, password: loginCredentials.password })
    .from(loginCredentials)
    .where(eq(loginCredentials.userId, userId))
    .limit(1);

  const nameChanged = existing.name !== config.name;
  let newHash: string | null = null;
  if (config.password.kind === 'hash') {
    if (credential?.password !== config.password.value) newHash = config.password.value;
  } else {
    const matches = credential?.password ? await verifyPassword({ hash: credential.password, password: config.password.value }) : false;
    if (!matches) newHash = await hashPassword(config.password.value);
  }

  if (!nameChanged && newHash === null && credential) return 'unchanged';

  await db.transaction(async (tx) => {
    if (nameChanged) await tx.update(users).set({ name: config.name, updatedAt: clock.now() }).where(eq(users.id, userId));
    if (newHash !== null) {
      if (credential) await tx.update(loginCredentials).set({ password: newHash, updatedAt: clock.now() }).where(eq(loginCredentials.id, credential.id));
      else await tx.insert(loginCredentials).values({ userId, accountId: String(userId), providerId: 'credential', password: newHash });
    }
    await recordAudit(tx, clock, {
      tenantId: null,
      userId: null,
      entity: 'super_admin',
      entityId: userId,
      action: 'alteracao',
      before: nameChanged ? { name: existing.name } : null,
      // Só o que mudou, sem valor de senha: a chave `senha` vira "[alterado]" na redação.
      after: { ...(nameChanged ? { name: config.name } : {}), ...(newHash !== null ? { senha: true } : {}) },
    });
  });
  logger.info({ userId, nameChanged, passwordChanged: newHash !== null }, 'super_admin: atualizado a partir do ambiente');
  return 'updated';
}
