/** D. Ausências: ajuste, atestado, afastamento (RF23 a RF32, RF61 a RF67). */
import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { employees, users } from './organization';
import { bytea, id, ref, rh, tenantId } from './rh';

// RF23 a RF26. Trigger trg_ajuste_periodo_fechado: migration 0002.
export const timeAdjustments = rh.table(
  'ajuste',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    date: date('data').notNull(),
    type: text('tipo').notNull(),
    proposedAt: timestamp('hora_proposta', { withTimezone: true }),
    reason: text('motivo').notNull(),
    attachmentUrl: text('anexo_url'),
    status: text('status').notNull().default('pendente'),
    requestedById: ref('solicitado_por').notNull(),
    requestedAt: timestamp('solicitado_em', { withTimezone: true }).notNull().defaultNow(),
    decidedById: ref('decidido_por'),
    decidedAt: timestamp('decidido_em', { withTimezone: true }),
    decisionReason: text('motivo_decisao'),
  },
  (t) => [
    foreignKey({
      name: 'ajuste_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({ name: 'ajuste_solicitado_por_fkey', columns: [t.requestedById], foreignColumns: [users.id] }),
    foreignKey({ name: 'ajuste_decidido_por_fkey', columns: [t.decidedById], foreignColumns: [users.id] }),
    unique('ajuste_conta_id_id_key').on(t.tenantId, t.id),
    check('ajuste_tipo', sql`tipo IN ('inclusao_batida','justificativa','abono')`),
    check('ajuste_status', sql`status IN ('pendente','aprovado','recusado')`),
    check('ajuste_hora_obrigatoria', sql`tipo <> 'inclusao_batida' OR hora_proposta IS NOT NULL`),
    check(
      'ajuste_decisao_coerente',
      sql`(status = 'pendente' AND decidido_por IS NULL AND decidido_em IS NULL) OR (status <> 'pendente' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)`,
    ),
    check('ajuste_recusa_com_motivo', sql`status <> 'recusado' OR motivo_decisao IS NOT NULL`),
    // quem pede não aprova o próprio pedido
    check('ajuste_decisor_diferente', sql`decidido_por IS NULL OR decidido_por <> solicitado_por`),
    index('idx_ajuste_pendente').on(t.employeeId).where(sql`status = 'pendente'`),
  ],
);

// RF27, RF28, RF32
export const medicalCertificates = rh.table(
  'atestado',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    startDate: date('data_inicio').notNull(),
    days: smallint('dias'),
    hours: smallint('horas'),
    fileUrl: text('arquivo_url').notNull(),
    /** SHA-256 em hex: detecta reenvio do mesmo arquivo. */
    fileHash: char('arquivo_hash', { length: 64 }).notNull(),
    doctorName: text('medico_nome'),
    doctorCrm: text('medico_crm'),
    doctorCrmUf: char('medico_crm_uf', { length: 2 }),
    /** Dado de saúde (RN15, LGPD): cifrado na aplicação, só o RH lê, toda leitura é auditada. Nunca sai na API sem decifrar no service. */
    cidEnc: bytea('cid_cifrado'),
    status: text('status').notNull().default('pendente'),
    sentAt: timestamp('enviado_em', { withTimezone: true }).notNull().defaultNow(),
    decidedById: ref('decidido_por'),
    decidedAt: timestamp('decidido_em', { withTimezone: true }),
    decisionReason: text('motivo_decisao'),
  },
  (t) => [
    foreignKey({
      name: 'atestado_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({ name: 'atestado_decidido_por_fkey', columns: [t.decidedById], foreignColumns: [users.id] }),
    unique('atestado_conta_id_id_key').on(t.tenantId, t.id),
    check('atestado_status', sql`status IN ('pendente','aprovado','recusado')`),
    // o atestado afasta por dias ou por horas, nunca pelos dois
    check('atestado_duracao', sql`num_nonnulls(dias, horas) = 1`),
    check('atestado_dias_pos', sql`dias IS NULL OR dias > 0`),
    check('atestado_horas_pos', sql`horas IS NULL OR horas > 0`),
    check('atestado_crm_uf', sql`medico_crm_uf IS NULL OR medico_crm_uf ~ '^[A-Z]{2}$'`),
    // RF64
    unique('atestado_arquivo_unico').on(t.employeeId, t.fileHash),
    check(
      'atestado_decisao_coerente',
      sql`(status = 'pendente' AND decidido_por IS NULL AND decidido_em IS NULL) OR (status <> 'pendente' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)`,
    ),
    check('atestado_recusa_com_motivo', sql`status <> 'recusado' OR motivo_decisao IS NOT NULL`),
    index('idx_atestado_pendente').on(t.employeeId).where(sql`status = 'pendente'`),
  ],
);

// RF61 a RF67: a heurística só sinaliza; quem decide é o RH
export const certificateAnalyses = rh.table(
  'atestado_analise',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    certificateId: ref('atestado_id').notNull().unique('atestado_analise_atestado_id_key'),
    /** Texto do OCR: dado de saúde, cifrado como o CID. */
    ocrTextEnc: bytea('ocr_texto_cifrado'),
    score: smallint('score').notNull(),
    riskLevel: text('nota_risco').notNull(),
    /** Regras disparadas, ex.: ["nome_divergente","crm_invalido"]. Nenhuma recusa o atestado sozinha. */
    reasons: jsonb('motivos').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    analyzedAt: timestamp('analisado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'atestado_analise_atestado_id_fkey',
      columns: [t.tenantId, t.certificateId],
      foreignColumns: [medicalCertificates.tenantId, medicalCertificates.id],
    }).onDelete('cascade'),
    check('analise_nota', sql`nota_risco IN ('baixo','medio','alto')`),
    check('analise_score', sql`score BETWEEN 0 AND 100`),
    check('analise_motivos', sql`jsonb_typeof(motivos) = 'array'`),
  ],
);

// RF29, RF30, RF31. Exclusion constraint afast_sem_sobreposicao: migration 0002.
export const absences = rh.table(
  'afastamento',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    type: text('tipo').notNull(),
    startDate: date('data_inicio').notNull(),
    endDate: date('data_fim').notNull(),
    certificateId: ref('atestado_id').unique('afastamento_atestado_id_key'),
  },
  (t) => [
    foreignKey({
      name: 'afastamento_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'afastamento_atestado_id_fkey',
      columns: [t.tenantId, t.certificateId],
      foreignColumns: [medicalCertificates.tenantId, medicalCertificates.id],
    }),
    check(
      'afast_tipo',
      sql`tipo IN ('atestado','maternidade','paternidade','casamento','obito','doacao_sangue','alistamento','inss','outro')`,
    ),
    check('afast_periodo', sql`data_fim >= data_inicio`),
    check(
      'afast_atestado_coerente',
      sql`(tipo = 'atestado' AND atestado_id IS NOT NULL) OR (tipo <> 'atestado' AND atestado_id IS NULL)`,
    ),
  ],
);
