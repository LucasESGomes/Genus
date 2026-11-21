/** B. Jornada: escala, feriado e parâmetros legais (RF07 a RF16, RN06, RNF06). */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { companies, employees, establishments, tenants, users } from './organization';
import { id, ref, rh, tenantId } from './rh';

// RF07, RF08
export const schedules = rh.table(
  'escala',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
    name: text('nome').notNull(),
    type: text('tipo').notNull(),
    cycleType: text('ciclo_tipo').notNull(),
    /** Só para ciclo 'ciclico' (12x36 = 2). */
    cycleDays: smallint('ciclo_dias'),
    /** Âncora do ciclo. */
    referenceDate: date('data_referencia'),
    weeklyMinutes: integer('carga_semanal_min').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'escala_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    unique('escala_conta_id_id_key').on(t.tenantId, t.id),
    check('escala_tipo', sql`tipo IN ('5x2','6x1','12x36','livre')`),
    check('escala_ciclo_tipo', sql`ciclo_tipo IN ('semanal','ciclico')`),
    check('escala_carga_pos', sql`carga_semanal_min > 0`),
    check('escala_ciclo_dias', sql`ciclo_dias IS NULL OR ciclo_dias BETWEEN 2 AND 60`),
    // escala semanal usa dia da semana; escala cíclica precisa de tamanho e âncora
    check(
      'escala_ciclo_coerente',
      sql`(ciclo_tipo = 'semanal' AND ciclo_dias IS NULL AND data_referencia IS NULL) OR (ciclo_tipo = 'ciclico' AND ciclo_dias IS NOT NULL AND data_referencia IS NOT NULL)`,
    ),
  ],
);

export const scheduleDays = rh.table(
  'escala_dia',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    scheduleId: ref('escala_id').notNull(),
    /** 0-6 = dia da semana; 0..n = posição do ciclo. */
    position: smallint('posicao').notNull(),
    isDayOff: boolean('folga').notNull().default(false),
    startTime: time('entrada'),
    endTime: time('saida'),
    breakStartTime: time('intervalo_inicio'),
    breakEndTime: time('intervalo_fim'),
    /** Saída no dia seguinte. */
    crossesMidnight: boolean('vira_dia').notNull().default(false),
  },
  (t) => [
    foreignKey({
      name: 'escala_dia_escala_id_fkey',
      columns: [t.tenantId, t.scheduleId],
      foreignColumns: [schedules.tenantId, schedules.id],
    }).onDelete('cascade'),
    unique('escala_dia_unico').on(t.scheduleId, t.position),
    check('escala_dia_posicao', sql`posicao >= 0`),
    // folga não tem horário; dia trabalhado tem entrada e saída
    check(
      'escala_dia_horario',
      sql`(folga AND entrada IS NULL AND saida IS NULL) OR (NOT folga AND entrada IS NOT NULL AND saida IS NOT NULL)`,
    ),
    check(
      'escala_dia_intervalo',
      sql`(intervalo_inicio IS NULL AND intervalo_fim IS NULL) OR (intervalo_inicio IS NOT NULL AND intervalo_fim IS NOT NULL AND intervalo_inicio < intervalo_fim)`,
    ),
  ],
);

// RF09. Exclusion constraint colab_escala_sem_sobreposicao: migration 0002.
export const employeeSchedules = rh.table(
  'colaborador_escala',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    scheduleId: ref('escala_id').notNull(),
    validFrom: date('vigencia_inicio').notNull(),
    validTo: date('vigencia_fim'),
  },
  (t) => [
    foreignKey({
      name: 'colaborador_escala_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'colaborador_escala_escala_id_fkey',
      columns: [t.tenantId, t.scheduleId],
      foreignColumns: [schedules.tenantId, schedules.id],
    }),
    check('colab_escala_vigencia', sql`vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio`),
  ],
);

// RF12: troca pontual de turno ou folga em um dia
export const scheduleOverrides = rh.table(
  'troca_turno',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    date: date('data').notNull(),
    isDayOff: boolean('folga').notNull().default(false),
    startTime: time('entrada'),
    endTime: time('saida'),
    reason: text('motivo').notNull(),
    createdById: ref('criado_por').notNull(),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'troca_turno_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({ name: 'troca_turno_criado_por_fkey', columns: [t.createdById], foreignColumns: [users.id] }),
    unique('troca_unica').on(t.employeeId, t.date),
    check(
      'troca_horario',
      sql`(folga AND entrada IS NULL AND saida IS NULL) OR (NOT folga AND entrada IS NOT NULL AND saida IS NOT NULL)`,
    ),
  ],
);

// RF14, RF15. Catálogo: conta_id NULL = feriado oficial, vale para todas as contas;
// com conta_id = feriado próprio da conta (ex.: ponto facultativo local).
export const holidays = rh.table(
  'feriado',
  {
    id: id(),
    tenantId: tenantId(),
    scope: text('abrangencia').notNull(),
    uf: char('uf', { length: 2 }),
    municipalityIbge: char('municipio_ibge', { length: 7 }),
    date: date('data').notNull(),
    name: text('nome').notNull(),
    isOptional: boolean('facultativo').notNull().default(false),
  },
  (t) => [
    foreignKey({ name: 'feriado_conta_id_fkey', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    check('feriado_abrangencia', sql`abrangencia IN ('nacional','estadual','municipal')`),
    // feriado nacional não tem UF; municipal exige UF e município
    check(
      'feriado_escopo',
      sql`(abrangencia = 'nacional' AND uf IS NULL AND municipio_ibge IS NULL) OR (abrangencia = 'estadual' AND uf IS NOT NULL AND municipio_ibge IS NULL) OR (abrangencia = 'municipal' AND uf IS NOT NULL AND municipio_ibge IS NOT NULL)`,
    ),
    // exige PostgreSQL 15+
    unique('feriado_unico').on(t.tenantId, t.date, t.scope, t.uf, t.municipalityIbge).nullsNotDistinct(),
    index('idx_feriado_data').on(t.date),
  ],
);

// RF16: o estabelecimento trabalha no feriado? como trata a hora?
export const establishmentHolidays = rh.table(
  'estabelecimento_feriado',
  {
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
    holidayId: ref('feriado_id').notNull(),
    isWorked: boolean('trabalha').notNull().default(false),
    treatment: text('tratamento'),
  },
  (t) => [
    primaryKey({ name: 'estabelecimento_feriado_pkey', columns: [t.establishmentId, t.holidayId] }),
    foreignKey({
      name: 'estabelecimento_feriado_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    // FK simples: o feriado pode ser global (conta_id NULL)
    foreignKey({ name: 'estabelecimento_feriado_feriado_id_fkey', columns: [t.holidayId], foreignColumns: [holidays.id] }),
    check('estab_fer_tratamento', sql`tratamento IS NULL OR tratamento IN ('pagar_100','banco_horas')`),
    check('estab_fer_coerente', sql`(NOT trabalha AND tratamento IS NULL) OR (trabalha AND tratamento IS NOT NULL)`),
  ],
);

// RF10, RN06, RNF06: nenhum valor legal fica fixo no código.
// conta_id NULL = valor legal padrão do Genus. Exclusion constraint param_sem_sobreposicao: migration 0002.
export const legalParameters = rh.table(
  'parametro_legal',
  {
    id: id(),
    tenantId: tenantId(),
    /** NULL = vale para a conta inteira (ou, sem conta, o padrão legal). */
    companyId: ref('empresa_id'),
    key: text('chave').notNull(),
    value: jsonb('valor').notNull(),
    legalBasis: text('base_legal'),
    validFrom: date('vigencia_inicio').notNull(),
    validTo: date('vigencia_fim'),
  },
  (t) => [
    foreignKey({ name: 'parametro_legal_conta_id_fkey', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({ name: 'param_empresa_fk', columns: [t.tenantId, t.companyId], foreignColumns: [companies.tenantId, companies.id] }),
    // a FK composta não confere a empresa quando conta_id é NULL
    check('param_empresa_tem_conta', sql`empresa_id IS NULL OR conta_id IS NOT NULL`),
    check('param_vigencia', sql`vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio`),
  ],
);
