/**
 * Tabelas do Better Auth no schema `rh`, com nomes em português (database.md §13).
 * O usuário é `usuarios` (organization.ts). As propriedades seguem os nomes que o
 * Better Auth espera (modules/auth/auth.ts liga cada modelo a uma tabela daqui).
 *
 * `conta_id` de sessoes, credenciais_login e dois_fatores é copiado do usuário por
 * trigger (migration 0008): o Better Auth não sabe de conta. É NULL para o
 * super_admin, que não pertence a conta nenhuma. `verificacoes` e `chaves_jwt` são
 * da plataforma (não guardam dado de conta) e não têm `conta_id`.
 *
 * Nada daqui sai na API nem em log: token de sessão, hash de senha, segredo TOTP,
 * códigos de backup e chave privada do JWT.
 */
import { boolean, index, integer, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants, users } from './organization';
import { id, ref, rh, tenantId } from './rh';

const createdAt = () => timestamp('criado_em', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow();

// `session` do Better Auth
export const sessions = rh.table(
  'sessoes',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    userId: ref('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique('sessao_token_key'),
    expiresAt: timestamp('expira_em', { withTimezone: true }).notNull(),
    ipAddress: text('endereco_ip'),
    userAgent: text('agente_usuario'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('idx_sessao_usuario').on(t.userId)],
);

// `account` do Better Auth. Só o provedor `credential` (e-mail + senha) por enquanto.
export const loginCredentials = rh.table(
  'credenciais_login',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    userId: ref('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('conta_provedor_id').notNull(),
    providerId: text('provedor').notNull(),
    accessToken: text('token_acesso'),
    refreshToken: text('token_renovacao'),
    idToken: text('token_id'),
    accessTokenExpiresAt: timestamp('token_acesso_expira_em', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('token_renovacao_expira_em', { withTimezone: true }),
    scope: text('escopo'),
    /** Hash scrypt do Better Auth. Nunca sai na API nem em log. */
    password: text('senha_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('credencial_provedor_key').on(t.providerId, t.accountId), index('idx_credencial_usuario').on(t.userId)],
);

// `verification` do Better Auth (tokens de uso único: 2FA em andamento, redefinição de senha)
export const verifications = rh.table(
  'verificacoes',
  {
    id: id(),
    identifier: text('identificador').notNull(),
    value: text('valor').notNull(),
    expiresAt: timestamp('expira_em', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('idx_verificacao_identificador').on(t.identifier)],
);

// `jwks` do plugin JWT: chaves que assinam o JWT curto. A privada vem cifrada pelo Better Auth.
export const jwtKeys = rh.table('chaves_jwt', {
  id: id(),
  publicKey: text('chave_publica').notNull(),
  privateKey: text('chave_privada').notNull(),
  alg: text('algoritmo'),
  crv: text('curva'),
  createdAt: createdAt(),
  expiresAt: timestamp('expira_em', { withTimezone: true }),
});

// `twoFactor` do plugin de 2FA (TOTP). Segredo e códigos de backup vêm cifrados pelo Better Auth.
export const twoFactors = rh.table(
  'dois_fatores',
  {
    id: id(),
    tenantId: tenantId().references(() => tenants.id),
    userId: ref('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secret: text('segredo').notNull(),
    backupCodes: text('codigos_backup').notNull(),
    verified: boolean('verificado').notNull().default(true),
    failedVerificationCount: integer('tentativas_falhas').notNull().default(0),
    lockedUntil: timestamp('bloqueado_ate', { withTimezone: true }),
  },
  (t) => [unique('dois_fatores_usuario_key').on(t.userId), index('idx_dois_fatores_segredo').on(t.secret)],
);
