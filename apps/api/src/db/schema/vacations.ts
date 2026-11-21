/**
 * F. Férias (RF39 a RF43, RN10, RN11).
 * Regras que o Drizzle não declara (migration 0002): exclusion constraints
 * pa_sem_sobreposicao e fg_pessoa_sem_sobreposicao, e os triggers
 * trg_ferias_limite_setor (setor desfalcado), trg_ferias_fracionamento e
 * trg_ferias_inicio_valido.
 */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { departments, employees, users } from './organization';
import { id, ref, rh, tenantId } from './rh';

// RF39, RF40, RN10
export const vacationAccrualPeriods = rh.table(
  'ferias_periodo_aquisitivo',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    startDate: date('inicio').notNull(),
    endDate: date('fim').notNull(),
    grantDeadline: date('concessivo_fim').notNull(),
    unjustifiedAbsences: smallint('faltas_injustificadas').notNull().default(0),
    entitledDays: smallint('dias_direito').notNull(),
    status: text('status').notNull().default('aberto'),
  },
  (t) => [
    foreignKey({
      name: 'ferias_periodo_aquisitivo_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    unique('ferias_periodo_aquisitivo_conta_id_id_key').on(t.tenantId, t.id),
    check('pa_periodo', sql`fim > inicio`),
    check('pa_concessivo', sql`concessivo_fim > fim`),
    check('pa_faltas', sql`faltas_injustificadas >= 0`),
    check('pa_status', sql`status IN ('aberto','concluido','vencido')`),
    // RN10: a tabela de faltas da CLT só produz estes cinco valores
    check('pa_dias_direito', sql`dias_direito IN (0,12,18,24,30)`),
    check(
      'pa_direito_bate_faltas',
      sql`dias_direito = CASE WHEN faltas_injustificadas <= 5 THEN 30 WHEN faltas_injustificadas <= 14 THEN 24 WHEN faltas_injustificadas <= 23 THEN 18 WHEN faltas_injustificadas <= 32 THEN 12 ELSE 0 END`,
    ),
  ],
);

// RF41 a RF43: aqui mora a regra do setor desfalcado
export const vacationInstallments = rh.table(
  'ferias_gozo',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    accrualPeriodId: ref('periodo_aquisitivo_id').notNull(),
    employeeId: ref('colaborador_id').notNull(),
    /**
     * Setor vigente no momento da solicitação, copiado de colaborador_vinculo.
     * Fica aqui porque o vínculo muda com o tempo e a regra do setor precisa
     * saber qual setor ficaria desfalcado naquelas datas.
     */
    departmentId: ref('setor_id').notNull(),
    startDate: date('data_inicio').notNull(),
    endDate: date('data_fim').notNull(),
    days: smallint('dias').generatedAlwaysAs(sql`data_fim - data_inicio + 1`),
    cashBonusDays: smallint('abono_pecuniario_dias').notNull().default(0),
    status: text('status').notNull().default('solicitada'),
    requestedById: ref('solicitado_por').notNull(),
    requestedAt: timestamp('solicitado_em', { withTimezone: true }).notNull().defaultNow(),
    decidedById: ref('decidido_por'),
    decidedAt: timestamp('decidido_em', { withTimezone: true }),
    decisionReason: text('motivo_decisao'),
  },
  (t) => [
    foreignKey({
      name: 'ferias_gozo_periodo_aquisitivo_id_fkey',
      columns: [t.tenantId, t.accrualPeriodId],
      foreignColumns: [vacationAccrualPeriods.tenantId, vacationAccrualPeriods.id],
    }),
    foreignKey({
      name: 'ferias_gozo_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'ferias_gozo_setor_id_fkey',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    foreignKey({ name: 'ferias_gozo_solicitado_por_fkey', columns: [t.requestedById], foreignColumns: [users.id] }),
    foreignKey({ name: 'ferias_gozo_decidido_por_fkey', columns: [t.decidedById], foreignColumns: [users.id] }),
    check('fg_periodo', sql`data_fim >= data_inicio`),
    check('fg_status', sql`status IN ('solicitada','aprovada','recusada','cancelada','gozada')`),
    // RN11: nenhum período de férias abaixo de 5 dias
    check('fg_minimo_5_dias', sql`data_fim - data_inicio + 1 >= 5`),
    check('fg_abono', sql`abono_pecuniario_dias BETWEEN 0 AND 10`),
    check(
      'fg_decisao_coerente',
      sql`(status = 'solicitada' AND decidido_por IS NULL AND decidido_em IS NULL) OR (status <> 'solicitada' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)`,
    ),
    check('fg_recusa_com_motivo', sql`status <> 'recusada' OR motivo_decisao IS NOT NULL`),
    check('fg_decisor_diferente', sql`decidido_por IS NULL OR decidido_por <> solicitado_por`),
    index('idx_ferias_setor_periodo')
      .on(t.departmentId, t.startDate, t.endDate)
      .where(sql`status IN ('aprovada','gozada')`),
  ],
);
