/**
 * Totem web (docs/totem-contrato.md §2): sessões de calibração e eventos do aparelho.
 * Trigger (eventos só aceitam INSERT), índice parcial e GRANT do coletor: migration 0012.
 */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, jsonb, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { devices, users } from './organization';
import { id, ref, rh, tenantId } from './rh';

export const CALIBRATION_STATUSES = ['aguardando', 'calculada', 'aplicada', 'descartada', 'falhou'] as const;
export const DEVICE_EVENT_TYPES = ['conexao', 'chave_regenerada', 'ativado', 'desativado', 'calibracao', 'cadastro_facial', 'sincronizacao'] as const;

// Uma sessão de calibração do totem. `resultado` guarda só números agregados: nunca imagem nem embedding.
export const calibrationSessions = rh.table(
  'sessoes_calibracao',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    deviceId: ref('aparelho_id').notNull(),
    status: text('status').notNull().default('aguardando'),
    startedById: ref('iniciada_por_id').notNull(),
    startedAt: timestamp('iniciada_em', { withTimezone: true }).notNull().defaultNow(),
    computedAt: timestamp('calculada_em', { withTimezone: true }),
    result: jsonb('resultado'),
    decidedById: ref('decidida_por_id'),
    decidedAt: timestamp('decidida_em', { withTimezone: true }),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'sessao_calibracao_aparelho_id_fkey', columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }).onDelete('cascade'),
    foreignKey({ name: 'sessao_calibracao_iniciada_por_id_fkey', columns: [t.tenantId, t.startedById], foreignColumns: [users.tenantId, users.id] }),
    foreignKey({ name: 'sessao_calibracao_decidida_por_id_fkey', columns: [t.tenantId, t.decidedById], foreignColumns: [users.tenantId, users.id] }),
    unique('sessao_calibracao_conta_id_id_key').on(t.tenantId, t.id),
    // no máximo uma sessão em aberto (aguardando ou calculada) por aparelho
    uniqueIndex('uq_sessao_calibracao_aberta').on(t.deviceId).where(sql`status IN ('aguardando','calculada')`),
    index('idx_sessao_calibracao_aparelho').on(t.tenantId, t.deviceId, t.startedAt.desc()),
    check('sessao_calibracao_status', sql`status IN ('aguardando','calculada','aplicada','descartada','falhou')`),
    check('sessao_calibracao_resultado', sql`resultado IS NULL OR jsonb_typeof(resultado) = 'object'`),
  ],
);

// Eventos do aparelho (só INSERT). `descricao` nunca leva dado pessoal.
export const deviceEvents = rh.table(
  'eventos_aparelho',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    deviceId: ref('aparelho_id').notNull(),
    type: text('tipo').notNull(),
    description: text('descricao').notNull(),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'evento_aparelho_aparelho_id_fkey', columns: [t.tenantId, t.deviceId], foreignColumns: [devices.tenantId, devices.id] }).onDelete('cascade'),
    index('idx_evento_aparelho').on(t.tenantId, t.deviceId, t.createdAt.desc()),
    check('evento_aparelho_tipo', sql`tipo IN ('conexao','chave_regenerada','ativado','desativado','calibracao','cadastro_facial','sincronizacao')`),
  ],
);
