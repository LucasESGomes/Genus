/** E. Banco de horas (RF33 a RF38, RN09). */
import { sql } from 'drizzle-orm';
import { bigint, check, date, foreignKey, index, integer, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { employees, establishments, users } from './organization';
import { id, ref, rh, tenantId } from './rh';
import { dailyTimesheets } from './timesheets';

// RF34, RN09
export const timeBankPolicies = rh.table(
  'banco_horas_regra',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id'),
    employeeId: ref('colaborador_id'),
    modality: text('modalidade').notNull(),
    sundayWeight: numeric('peso_domingo', { precision: 3, scale: 2 }).notNull().default('1.00'),
    holidayWeight: numeric('peso_feriado', { precision: 3, scale: 2 }).notNull().default('1.00'),
    validFrom: date('vigencia_inicio').notNull(),
    validTo: date('vigencia_fim'),
  },
  (t) => [
    foreignKey({
      name: 'banco_horas_regra_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    foreignKey({
      name: 'banco_horas_regra_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    check('bh_regra_modalidade', sql`modalidade IN ('individual_6m','coletivo_12m')`),
    check('bh_regra_pesos', sql`peso_domingo >= 1 AND peso_feriado >= 1`),
    // a regra vale para um estabelecimento ou para uma pessoa, nunca para os dois
    check('bh_regra_escopo', sql`num_nonnulls(estabelecimento_id, colaborador_id) = 1`),
    check('bh_regra_vigencia', sql`vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio`),
  ],
);

// RF33, RF35 a RF38: o saldo é a soma dos lançamentos, nunca um campo editável
export const timeBankEntries = rh.table(
  'banco_horas_lancamento',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    dailyTimesheetId: ref('apuracao_dia_id'),
    type: text('tipo').notNull(),
    /** Positivo credita, negativo debita. */
    minutes: integer('minutos').notNull(),
    referenceDate: date('data_competencia').notNull(),
    dueDate: date('data_vencimento'),
    createdById: ref('criado_por').notNull(),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'banco_horas_lancamento_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'banco_horas_lancamento_apuracao_dia_id_fkey',
      columns: [t.tenantId, t.dailyTimesheetId],
      foreignColumns: [dailyTimesheets.tenantId, dailyTimesheets.id],
    }),
    foreignKey({ name: 'banco_horas_lancamento_criado_por_fkey', columns: [t.createdById], foreignColumns: [users.id] }),
    check('bh_tipo', sql`tipo IN ('credito','debito','folga_compensatoria','pagamento','desconto','expiracao')`),
    check('bh_minutos_nao_zero', sql`minutos <> 0`),
    // crédito soma, todo o resto subtrai
    check('bh_sinal_coerente', sql`(tipo = 'credito' AND minutos > 0) OR (tipo <> 'credito' AND minutos < 0)`),
    check('bh_vencimento', sql`data_vencimento IS NULL OR data_vencimento > data_competencia`),
    index('idx_bh_colab').on(t.employeeId, t.referenceDate),
    index('idx_bh_vencimento').on(t.dueDate).where(sql`data_vencimento IS NOT NULL`),
  ],
);

/** Saldo por colaborador. A view é criada na migration 0002; aqui só é declarada para leitura tipada. */
export const timeBankBalances = rh
  .view('vw_banco_horas_saldo', {
    tenantId: bigint('conta_id', { mode: 'number' }).notNull(),
    employeeId: bigint('colaborador_id', { mode: 'number' }).notNull(),
    balanceMinutes: bigint('saldo_minutos', { mode: 'number' }),
    expiringIn30DaysMinutes: bigint('minutos_vencendo_30d', { mode: 'number' }),
  })
  .existing();
