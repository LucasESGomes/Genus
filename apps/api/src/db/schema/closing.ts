/**
 * G. Fechamento, espelho e auditoria (RF46 a RF49, RF60, RNF03).
 * Triggers da migration 0002: trg_auditoria_imutavel (auditoria só aceita
 * INSERT) e fn_bloqueia_periodo_fechado (em apuracao_dia e ajuste).
 */
import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, inet, jsonb, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { employees, establishments, tenants, users } from './organization';
import { id, ref, rh, tenantId } from './rh';

// RF46, RF49
export const closingPeriods = rh.table(
  'fechamentos',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
    /** Primeiro dia do mês. */
    referenceMonth: date('competencia').notNull(),
    startDate: date('data_inicio').notNull(),
    endDate: date('data_fim').notNull(),
    status: text('status').notNull().default('aberto'),
    closedById: ref('fechado_por'),
    closedAt: timestamp('fechado_em', { withTimezone: true }),
    reopenedById: ref('reaberto_por'),
    reopenedAt: timestamp('reaberto_em', { withTimezone: true }),
    reopenReason: text('motivo_reabertura'),
  },
  (t) => [
    foreignKey({
      name: 'fechamento_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    foreignKey({ name: 'fechamento_fechado_por_fkey', columns: [t.closedById], foreignColumns: [users.id] }),
    foreignKey({ name: 'fechamento_reaberto_por_fkey', columns: [t.reopenedById], foreignColumns: [users.id] }),
    unique('fechamento_conta_id_id_key').on(t.tenantId, t.id),
    unique('fech_unico').on(t.establishmentId, t.referenceMonth),
    check('fech_periodo', sql`data_fim >= data_inicio`),
    check('fech_status', sql`status IN ('aberto','fechado','reaberto')`),
    check('fech_competencia_dia_1', sql`extract(day FROM competencia) = 1`),
    check(
      'fech_fechado_coerente',
      sql`(status = 'aberto' AND fechado_por IS NULL) OR (status <> 'aberto' AND fechado_por IS NOT NULL AND fechado_em IS NOT NULL)`,
    ),
    // RF49: reabertura sempre com autor e motivo
    check(
      'fech_reabertura_coerente',
      sql`status <> 'reaberto' OR (reaberto_por IS NOT NULL AND reaberto_em IS NOT NULL AND motivo_reabertura IS NOT NULL)`,
    ),
  ],
);

// RF47, RF48
export const timeMirrors = rh.table(
  'espelhos',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    closingPeriodId: ref('fechamento_id').notNull(),
    employeeId: ref('colaborador_id').notNull(),
    pdfUrl: text('pdf_url'),
    acknowledgedAt: timestamp('ciencia_em', { withTimezone: true }),
    acknowledgedIp: inet('ciencia_ip'),
  },
  (t) => [
    foreignKey({
      name: 'espelho_fechamento_id_fkey',
      columns: [t.tenantId, t.closingPeriodId],
      foreignColumns: [closingPeriods.tenantId, closingPeriods.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'espelho_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    unique('espelho_unico').on(t.closingPeriodId, t.employeeId),
    check('espelho_ciencia', sql`(ciencia_em IS NULL) = (ciencia_ip IS NULL)`),
  ],
);

// RF60, RNF03. Inclui a leitura de dado sensível (acao = leitura_sensivel): é como a LGPD
// é atendida para CID e arquivo de atestado (RN15, RNF04). Nenhum segredo em dados_antes/dados_depois.
// conta_id NULL = ação da plataforma (super_admin) fora de qualquer conta.
export const auditLogs = rh.table(
  'auditorias',
  {
    id: id(),
    tenantId: tenantId(),
    userId: ref('usuario_id'),
    entity: text('entidade').notNull(),
    entityId: bigint('entidade_id', { mode: 'number' }).notNull(),
    action: text('acao').notNull(),
    before: jsonb('dados_antes'),
    after: jsonb('dados_depois'),
    reason: text('motivo'),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'auditoria_conta_id_fkey', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    // FK simples: o super_admin audita ações dentro de uma conta sem pertencer a ela
    foreignKey({ name: 'auditoria_usuario_id_fkey', columns: [t.userId], foreignColumns: [users.id] }),
    check(
      'auditoria_acao',
      sql`acao IN ('criacao','alteracao','exclusao','leitura_sensivel','aprovacao','recusa','fechamento','reabertura')`,
    ),
    index('idx_auditoria_entidade').on(t.entity, t.entityId, t.createdAt.desc()),
    index('idx_auditoria_conta').on(t.tenantId, t.createdAt.desc()),
    index('idx_auditoria_usuario').on(t.userId, t.id.desc()),
  ],
);
