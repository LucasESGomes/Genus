/**
 * Tabelas do painel do super_admin (docs/prompts/super-admin-contrato.md).
 *
 * `tentativas_login`: uma linha por tentativa de login (senha ou TOTP), só INSERT (trigger na 0015).
 * Nunca guarda o e-mail em claro: `email_hash` é HMAC-SHA256 com chave derivada do BETTER_AUTH_SECRET,
 * para contar e-mails distintos por IP sem saber quais são. Só sinaliza; nada é bloqueado por aqui.
 * Retenção de 90 dias [A CONFIRMAR].
 */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, text, timestamp } from 'drizzle-orm/pg-core';
import { tenants, users } from './organization';
import { bytea, id, ref, rh, tenantId } from './rh';

export const LOGIN_STEPS = ['senha', 'totp'] as const;
export const LOGIN_FAILURE_REASONS = ['credencial_invalida', 'usuario_inativo', 'conta_suspensa', 'totp_invalido'] as const;

export const loginAttempts = rh.table(
  'tentativas_login',
  {
    id: id(),
    /** Conta do usuário que casou com o e-mail; NULL se não casou ou se é o super_admin. */
    tenantId: tenantId(),
    userId: ref('usuario_id'),
    emailHash: bytea('email_hash').notNull(),
    ipAddress: text('endereco_ip'),
    userAgent: text('agente_usuario'),
    step: text('etapa').notNull(),
    isSuccess: boolean('eh_sucesso').notNull(),
    failureReason: text('motivo'),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'tentativa_login_conta_id_fkey', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({ name: 'tentativa_login_usuario_id_fkey', columns: [t.userId], foreignColumns: [users.id] }),
    check('tentativa_login_etapa', sql`etapa IN ('senha','totp')`),
    check('tentativa_login_motivo', sql`motivo IS NULL OR motivo IN ('credencial_invalida','usuario_inativo','conta_suspensa','totp_invalido')`),
    check('tentativa_login_coerente', sql`eh_sucesso = (motivo IS NULL)`),
    index('idx_tentativa_login_ip').on(t.ipAddress, t.createdAt.desc()),
    index('idx_tentativa_login_criado').on(t.createdAt.desc()),
  ],
);
