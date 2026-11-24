/**
 * Biometria facial (RF04, LGPD). O RH só GUARDA o que a criptografia já pronta
 * produz (packages/shared/src/crypto.ts e o face-engine); nada aqui cifra ou decifra.
 *
 * Criptografia dupla (envelope):
 *   1. o embedding é cifrado pela engine com a DEK da EMPRESA (AES-256-GCM);
 *   2. a DEK da empresa fica em `chaves_empresa`, cifrada com a MASTER_KEY
 *      (só no ambiente, nunca no banco).
 * As colunas `dek_*` e `embedding_*` espelham o contrato da engine (database.md §10).
 * Nenhuma coluna BYTEA daqui sai na API nem em log.
 *
 * Triggers e permissões que o Drizzle não declara estão na migration 0005.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, inet, integer, smallint, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { companies, devices, employees, users } from './organization';
import { bytea, id, ref, rh, tenantId } from './rh';

// DEK de cada empresa, cifrada com a MASTER_KEY. Uma ativa por empresa; as
// antigas ficam (rotação) porque embeddings ainda podem apontar para elas.
export const companyKeys = rh.table(
  'chaves_empresa',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    companyId: ref('empresa_id').notNull(),
    /** Versão da DEK desta empresa; vai à engine como `key_version` do embedding. */
    keyVersion: integer('versao_chave').notNull(),
    dekIv: bytea('dek_iv').notNull(),
    dekTag: bytea('dek_tag').notNull(),
    dekCt: bytea('dek_ct').notNull(),
    /** Versão da MASTER_KEY que cifrou a DEK; vai à engine como `dek_key_version`. */
    masterKeyVersion: integer('versao_kek').notNull().default(1),
    isActive: boolean('eh_ativa').notNull().default(true),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'chave_empresa_empresa_id_fkey',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    unique('chave_empresa_versao_key').on(t.companyId, t.keyVersion),
    // alvo da FK composta de embeddings_faciais
    unique('chave_empresa_conta_versao_key').on(t.tenantId, t.companyId, t.keyVersion),
    uniqueIndex('uq_chave_empresa_ativa').on(t.companyId).where(sql`eh_ativa`),
    check('chave_empresa_versao_pos', sql`versao_chave >= 1 AND versao_kek >= 1`),
    check('chave_empresa_tamanhos', sql`octet_length(dek_iv) = 12 AND octet_length(dek_tag) = 16 AND octet_length(dek_ct) = 32`),
  ],
);

// Consentimento biométrico (security-lgpd.md): exigido antes do cadastro do rosto.
// Revogado não se apaga (é prova); só ganha revogado_em e motivo.
export const biometricConsents = rh.table(
  'consentimentos_biometricos',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    /** Versão do texto de consentimento aceito ([A CONFIRMAR] com o parecer jurídico). */
    textVersion: text('versao_texto').notNull(),
    consentedAt: timestamp('consentido_em', { withTimezone: true }).notNull(),
    ipAddress: inet('endereco_ip'),
    deviceId: ref('aparelho_id'),
    collectedById: ref('coletado_por_id'),
    revokedAt: timestamp('revogado_em', { withTimezone: true }),
    revocationReason: text('motivo_revogacao'),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'consentimento_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'consentimento_aparelho_id_fkey',
      columns: [t.tenantId, t.deviceId],
      foreignColumns: [devices.tenantId, devices.id],
    }),
    foreignKey({
      name: 'consentimento_coletado_por_id_fkey',
      columns: [t.tenantId, t.collectedById],
      foreignColumns: [users.tenantId, users.id],
    }),
    // alvo da FK composta de embeddings_faciais: o consentimento é da mesma pessoa
    unique('consentimento_conta_colab_id_key').on(t.tenantId, t.employeeId, t.id),
    uniqueIndex('uq_consentimento_ativo').on(t.employeeId).where(sql`revogado_em IS NULL`),
    check('consentimento_revogacao_par', sql`(revogado_em IS NULL) = (motivo_revogacao IS NULL)`),
    check('consentimento_revogacao_data', sql`revogado_em IS NULL OR revogado_em >= consentido_em`),
  ],
);

// Embedding facial do colaborador: o ciphertext que a engine devolve, guardado como veio.
// Um por colaborador; recadastro troca a linha. Sem histórico: biometria se apaga de verdade.
export const facialEmbeddings = rh.table(
  'embeddings_faciais',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    /** Vai à engine como `person_id`. */
    employeeId: ref('colaborador_id').notNull(),
    /** Empresa do colaborador: dona da DEK que cifrou o embedding. */
    companyId: ref('empresa_id').notNull(),
    consentId: ref('consentimento_id').notNull(),
    keyVersion: integer('versao_chave').notNull(),
    embeddingIv: bytea('embedding_iv').notNull(),
    embeddingTag: bytea('embedding_tag').notNull(),
    embeddingCt: bytea('embedding_ct').notNull(),
    /** `model_version` devolvido pela engine (ex.: arcface_r50_v1). */
    modelVersion: text('versao_modelo').notNull(),
    imageCount: smallint('qtd_imagens').notNull(),
    origin: text('origem').notNull(),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'embedding_consentimento_fkey',
      columns: [t.tenantId, t.employeeId, t.consentId],
      foreignColumns: [biometricConsents.tenantId, biometricConsents.employeeId, biometricConsents.id],
    }),
    foreignKey({
      name: 'embedding_chave_empresa_fkey',
      columns: [t.tenantId, t.companyId, t.keyVersion],
      foreignColumns: [companyKeys.tenantId, companyKeys.companyId, companyKeys.keyVersion],
    }),
    unique('embedding_colaborador_key').on(t.tenantId, t.employeeId),
    index('idx_embedding_empresa').on(t.companyId),
    check('embedding_tamanhos', sql`octet_length(embedding_iv) = 12 AND octet_length(embedding_tag) = 16 AND octet_length(embedding_ct) = 2048`),
    check('embedding_qtd_imagens', sql`qtd_imagens BETWEEN 1 AND 5`),
    check('embedding_origem', sql`origem IN ('quiosque','portal')`),
  ],
);
