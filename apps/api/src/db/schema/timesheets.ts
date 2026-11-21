/** C. Apuração (RF18 a RF22). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { timeAdjustments } from './absences';
import { employees, users } from './organization';
import { id, ref, rh, tenantId } from './rh';
import { schedules } from './schedules';

// RF18 a RF22: resultado do dia já calculado. Trigger trg_apuracao_periodo_fechado: migration 0002.
export const dailyTimesheets = rh.table(
  'apuracoes_dia',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    date: date('data').notNull(),
    scheduleId: ref('escala_id'),
    situation: text('situacao').notNull(),
    expectedMinutes: integer('minutos_previstos').notNull().default(0),
    workedMinutes: integer('minutos_trabalhados').notNull().default(0),
    absenceMinutes: integer('minutos_falta').notNull().default(0),
    lateMinutes: integer('minutos_atraso').notNull().default(0),
    overtime50Minutes: integer('minutos_extra_50').notNull().default(0),
    overtime100Minutes: integer('minutos_extra_100').notNull().default(0),
    nightMinutes: integer('minutos_noturno').notNull().default(0),
    breakMinutes: integer('minutos_intervalo').notNull().default(0),
    isDsrDeducted: boolean('dsr_descontado').notNull().default(false),
    /** RNF06: qual regra gerou o número. */
    parameterVersion: text('parametro_versao').notNull(),
    calculatedAt: timestamp('calculado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'apuracao_dia_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'apuracao_dia_escala_id_fkey',
      columns: [t.tenantId, t.scheduleId],
      foreignColumns: [schedules.tenantId, schedules.id],
    }),
    unique('apuracao_dia_conta_id_id_key').on(t.tenantId, t.id),
    unique('apuracao_dia_unico').on(t.employeeId, t.date),
    check('apuracao_situacao', sql`situacao IN ('normal','falta','folga','feriado','ferias','afastamento')`),
    check(
      'apuracao_minutos_nao_negativos',
      sql`minutos_previstos >= 0 AND minutos_trabalhados >= 0 AND minutos_falta >= 0 AND minutos_atraso >= 0 AND minutos_extra_50 >= 0 AND minutos_extra_100 >= 0 AND minutos_noturno >= 0 AND minutos_intervalo >= 0`,
    ),
    check('apuracao_noturno_cabe', sql`minutos_noturno <= minutos_trabalhados`),
    index('idx_apuracao_colab_data').on(t.employeeId, t.date.desc()),
    index('idx_apuracao_data').on(t.date),
  ],
);

// As batidas originais vivem no banco arp e não são copiadas nem alteradas (RN01).
// Aqui fica a visão resolvida do dia: original + tratada.
export const timesheetPunches = rh.table(
  'apuracoes_marcacoes',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    dailyTimesheetId: ref('apuracao_dia_id').notNull(),
    sequence: smallint('sequencia').notNull(),
    punchedAt: timestamp('hora', { withTimezone: true }).notNull(),
    origin: text('origem').notNull(),
    /** Referência lógica ao banco arp: sem FK entre bancos. */
    nsr: ref('nsr'),
    adjustmentId: ref('ajuste_id'),
  },
  (t) => [
    foreignKey({
      name: 'apuracao_marcacao_apuracao_dia_id_fkey',
      columns: [t.tenantId, t.dailyTimesheetId],
      foreignColumns: [dailyTimesheets.tenantId, dailyTimesheets.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'marcacao_ajuste_fk',
      columns: [t.tenantId, t.adjustmentId],
      foreignColumns: [timeAdjustments.tenantId, timeAdjustments.id],
    }),
    unique('marcacao_unica').on(t.dailyTimesheetId, t.sequence),
    check('marcacao_origem', sql`origem IN ('original','tratada')`),
    check('marcacao_sequencia', sql`sequencia > 0`),
    // batida original vem do REP com NSR; marcação tratada vem de um ajuste aprovado
    check(
      'marcacao_procedencia',
      sql`(origem = 'original' AND nsr IS NOT NULL AND ajuste_id IS NULL) OR (origem = 'tratada' AND nsr IS NULL AND ajuste_id IS NOT NULL)`,
    ),
    index('idx_marcacao_dia').on(t.dailyTimesheetId, t.sequence),
  ],
);

// RF21
export const timesheetIssues = rh.table(
  'inconsistencias',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    dailyTimesheetId: ref('apuracao_dia_id').notNull(),
    type: text('tipo').notNull(),
    isResolved: boolean('resolvida').notNull().default(false),
    resolvedById: ref('resolvida_por'),
    resolvedAt: timestamp('resolvida_em', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'inconsistencia_apuracao_dia_id_fkey',
      columns: [t.tenantId, t.dailyTimesheetId],
      foreignColumns: [dailyTimesheets.tenantId, dailyTimesheets.id],
    }).onDelete('cascade'),
    foreignKey({ name: 'inconsistencia_resolvida_por_fkey', columns: [t.resolvedById], foreignColumns: [users.id] }),
    unique('inconsistencia_unica').on(t.dailyTimesheetId, t.type),
    check(
      'inconsistencia_tipo',
      sql`tipo IN ('batida_faltando','batidas_impares','interjornada_menor_11h','extra_acima_2h','intervalo_nao_cumprido')`,
    ),
    check(
      'inconsistencia_resolucao',
      sql`(NOT resolvida AND resolvida_por IS NULL AND resolvida_em IS NULL) OR (resolvida AND resolvida_por IS NOT NULL AND resolvida_em IS NOT NULL)`,
    ),
  ],
);
