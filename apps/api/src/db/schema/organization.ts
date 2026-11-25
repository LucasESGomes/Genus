/** A. Organização e pessoas (RF01 a RF06, RNF02). */
import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  numeric,
  real,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { bytea, citext, id, ref, rh, tenantId } from './rh';

// Conta (tenant) do SaaS: conta → empresa → estabelecimento → colaborador (04 §G1).
// É o mesmo `conta_id` que o banco arp grava em cada batida.
// Suspensão (painel do super_admin): `ativo = false` + motivo. Sem delete físico nem coluna de exclusão.
export const tenants = rh.table(
  'contas',
  {
    id: id(),
    name: text('nome').notNull(),
    isActive: boolean('ativo').notNull().default(true),
    suspensionReason: text('motivo_suspensao'),
    suspendedAt: timestamp('suspensa_em', { withTimezone: true }),
    // FK para usuarios(id) na migration 0015 (SQL manual): declarar aqui cria um ciclo de tipos contas ↔ usuarios.
    suspendedById: ref('suspensa_por_id'),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check(
      'conta_suspensao_coerente',
      sql`ativo = (suspensa_em IS NULL) AND (ativo OR motivo_suspensao IS NOT NULL)`,
    ),
  ],
);

export const companies = rh.table(
  'empresas',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    legalName: text('razao_social').notNull(),
    cnpj: char('cnpj', { length: 14 }).notNull(),
    isActive: boolean('ativo').notNull().default(true),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'empresa_conta_id_fkey', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    unique('empresa_conta_id_id_key').on(t.tenantId, t.id),
    // CNPJ único por conta, como o CPF (04 §G1)
    unique('empresa_cnpj_unico').on(t.tenantId, t.cnpj),
    check('empresa_cnpj_formato', sql`cnpj ~ '^[0-9]{14}$'`),
  ],
);

// [JÁ PODE EXISTIR] RF01. É a unidade da sequência de NSR no arp (estabelecimento_id).
export const establishments = rh.table(
  'estabelecimentos',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    companyId: ref('empresa_id').notNull(),
    name: text('nome').notNull(),
    registrationType: text('tipo_inscricao').notNull(),
    registration: text('inscricao').notNull(),
    uf: char('uf', { length: 2 }).notNull(),
    /** Define os feriados municipais. */
    municipalityIbge: char('municipio_ibge', { length: 7 }).notNull(),
    isActive: boolean('ativo').notNull().default(true),
  },
  (t) => [
    foreignKey({
      name: 'estabelecimento_empresa_id_fkey',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    unique('estabelecimento_conta_id_id_key').on(t.tenantId, t.id),
    check('estab_tipo_inscricao', sql`tipo_inscricao IN ('CNPJ','CPF','CAEPF')`),
    check('estab_uf_formato', sql`uf ~ '^[A-Z]{2}$'`),
    check('estab_ibge_formato', sql`municipio_ibge ~ '^[0-9]{7}$'`),
    unique('estab_inscricao_unica').on(t.companyId, t.registration),
  ],
);

// Aparelho coletor do estabelecimento. O arp grava `aparelho_id` em cada batida;
// a autenticação do aparelho (certificado, chave) é da parte do ponto e entra depois.
export const devices = rh.table(
  'aparelhos',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
    name: text('nome').notNull(),
    isActive: boolean('ativo').notNull().default(true),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    /** SHA-256 da chave `gk_...` do totem. A chave em claro nunca é gravada (docs/totem-contrato.md §2). */
    keyHash: bytea('chave_hash'),
    /** 8 primeiros caracteres da chave, só para o RH reconhecer qual é. */
    keyPrefix: text('chave_prefixo'),
    keyGeneratedAt: timestamp('chave_gerada_em', { withTimezone: true }),
    lastConnectionAt: timestamp('ultima_conexao_em', { withTimezone: true }),
    appVersion: text('versao_app'),
    /** NULL = padrão da engine. */
    recognitionThreshold: real('limiar_reconhecimento'),
    livenessThreshold: real('limiar_vivacidade'),
    calibratedAt: timestamp('calibrado_em', { withTimezone: true }),
    calibrationSourceId: ref('calibracao_origem_id'),
  },
  (t) => [
    foreignKey({
      name: 'aparelho_calibracao_origem_fkey',
      columns: [t.tenantId, t.calibrationSourceId],
      foreignColumns: [t.tenantId, t.id],
    }),
    unique('aparelho_chave_hash_key').on(t.keyHash),
    check('aparelho_limiar_reconhecimento', sql`limiar_reconhecimento IS NULL OR (limiar_reconhecimento >= 0.5 AND limiar_reconhecimento <= 2.0)`),
    check('aparelho_limiar_vivacidade', sql`limiar_vivacidade IS NULL OR (limiar_vivacidade >= 0.5 AND limiar_vivacidade <= 0.95)`),
    foreignKey({
      name: 'aparelho_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    unique('aparelho_conta_id_id_key').on(t.tenantId, t.id),
    unique('aparelho_nome_unico').on(t.establishmentId, t.name),
  ],
);

// RF02: guarda o limite de férias simultâneas (regra do setor desfalcado)
export const departments = rh.table(
  'setores',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
    name: text('nome').notNull(),
    /** Quantas pessoas do setor podem estar de férias ao mesmo tempo. Ver trigger trg_ferias_limite_setor. */
    maxSimultaneousVacations: smallint('limite_ferias_simultaneas').notNull().default(1),
  },
  (t) => [
    foreignKey({
      name: 'setor_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    unique('setor_conta_id_id_key').on(t.tenantId, t.id),
    check('setor_limite_positivo', sql`limite_ferias_simultaneas >= 1`),
    unique('setor_nome_unico').on(t.establishmentId, t.name),
  ],
);

// RF02
export const jobTitles = rh.table(
  'cargos',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    companyId: ref('empresa_id').notNull(),
    name: text('nome').notNull(),
    cbo: char('cbo', { length: 6 }),
  },
  (t) => [
    foreignKey({
      name: 'cargo_empresa_id_fkey',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    unique('cargo_conta_id_id_key').on(t.tenantId, t.id),
    check('cargo_cbo_formato', sql`cbo IS NULL OR cbo ~ '^[0-9]{6}$'`),
    unique('cargo_nome_unico').on(t.companyId, t.name),
  ],
);

// RF02
export const costCenters = rh.table(
  'centros_custo',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    companyId: ref('empresa_id').notNull(),
    code: text('codigo').notNull(),
    name: text('nome').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'centro_custo_empresa_id_fkey',
      columns: [t.tenantId, t.companyId],
      foreignColumns: [companies.tenantId, companies.id],
    }),
    unique('centro_custo_conta_id_id_key').on(t.tenantId, t.id),
    unique('cc_codigo_unico').on(t.companyId, t.code),
  ],
);

// [JÁ PODE EXISTIR] RF03, RF05. O arp grava `colaborador_id` e `cpf` de cada batida.
export const employees = rh.table(
  'colaboradores',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
    cpf: char('cpf', { length: 11 }).notNull(),
    name: text('nome').notNull(),
    registrationNumber: text('matricula'),
    birthDate: date('data_nascimento').notNull(),
    admissionDate: date('data_admissao').notNull(),
    terminationDate: date('data_desligamento'),
    terminationReason: text('motivo_desligamento'),
    managerId: ref('gestor_id'),
    /**
     * PIN do modo alternativo (sem facial): matrícula ou CPF + PIN. Obrigatório:
     * todo colaborador tem um. Só o hash scrypt com sal e pepper
     * (`scrypt$<pepper>$N$r$p$sal$hash`, ver modules/employees/pin.ts).
     * Nunca em log, resposta, auditoria nem na lista do aparelho.
     */
    pinHash: text('pin_hash').notNull(),
    pinSetAt: timestamp('pin_definido_em', { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({
      name: 'colaborador_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
    foreignKey({ name: 'colaborador_gestor_id_fkey', columns: [t.tenantId, t.managerId], foreignColumns: [t.tenantId, t.id] }),
    unique('colaborador_conta_id_id_key').on(t.tenantId, t.id),
    // CPF único por conta (04 §G1), igual ao índice (conta_id, cpf) do arp
    unique('colaborador_cpf_unico').on(t.tenantId, t.cpf),
    check('colab_cpf_formato', sql`cpf ~ '^[0-9]{11}$'`),
    check('colab_admissao_valida', sql`data_admissao > data_nascimento`),
    check('colab_desligamento', sql`data_desligamento IS NULL OR data_desligamento >= data_admissao`),
    // desligamento sempre com motivo, e motivo só com desligamento
    check('colab_motivo_par', sql`(data_desligamento IS NULL) = (motivo_desligamento IS NULL)`),
    check('colab_nao_gestor_si', sql`gestor_id IS DISTINCT FROM id`),
    // Recusa PIN em claro ou hash de outro formato; a conferência é no código
    check(
      'colab_pin_formato',
      sql`pin_hash ~ '^scrypt\\$[0-9]+\\$[0-9]+\\$[0-9]+\\$[0-9]+\\$[A-Za-z0-9_-]+\\$[A-Za-z0-9_-]+$'`,
    ),
    unique('colab_matricula_unica').on(t.establishmentId, t.registrationNumber),
    index('idx_colaborador_estab').on(t.establishmentId).where(sql`data_desligamento IS NULL`),
    index('idx_colaborador_gestor').on(t.managerId),
  ],
);

// RF06: histórico de cargo, setor, centro de custo e salário.
// A exclusion constraint vinculo_sem_sobreposicao está na migration 0002 (o Drizzle não declara EXCLUDE).
export const employeeAssignments = rh.table(
  'vinculos_colaborador',
  {
    id: id(),
    tenantId: tenantId().notNull(),
    employeeId: ref('colaborador_id').notNull(),
    jobTitleId: ref('cargo_id').notNull(),
    departmentId: ref('setor_id').notNull(),
    costCenterId: ref('centro_custo_id'),
    contractType: text('tipo_contrato').notNull(),
    /** [A CONFIRMAR] com o contador. `numeric` chega como string: nunca converter para float. */
    baseSalary: numeric('salario_base', { precision: 12, scale: 2 }),
    validFrom: date('vigencia_inicio').notNull(),
    validTo: date('vigencia_fim'),
  },
  (t) => [
    foreignKey({
      name: 'colaborador_vinculo_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    foreignKey({
      name: 'colaborador_vinculo_cargo_id_fkey',
      columns: [t.tenantId, t.jobTitleId],
      foreignColumns: [jobTitles.tenantId, jobTitles.id],
    }),
    foreignKey({
      name: 'colaborador_vinculo_setor_id_fkey',
      columns: [t.tenantId, t.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
    }),
    foreignKey({
      name: 'colaborador_vinculo_centro_custo_id_fkey',
      columns: [t.tenantId, t.costCenterId],
      foreignColumns: [costCenters.tenantId, costCenters.id],
    }),
    check('vinculo_tipo_contrato', sql`tipo_contrato IN ('indeterminado','determinado','safra','intermitente')`),
    check('vinculo_salario_pos', sql`salario_base IS NULL OR salario_base > 0`),
    check('vinculo_vigencia', sql`vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio`),
    index('idx_vinculo_colab_vigencia').on(t.employeeId, t.validFrom.desc()),
  ],
);

// Perfis de acesso. É a tabela `user` do Better Auth (modules/auth/auth.ts): as
// propriedades `name`, `email`, `emailVerified`, `image`, `createdAt` e `updatedAt`
// são as que ele espera. A senha NÃO fica aqui: fica em `credenciais_login`.
export const users = rh.table(
  'usuarios',
  {
    id: id(),
    /** NULL só para super_admin (operador da plataforma, fora de qualquer conta). */
    tenantId: tenantId(),
    employeeId: ref('colaborador_id').unique('usuario_colaborador_id_key'),
    name: text('nome').notNull(),
    /** Login: único na plataforma inteira. */
    email: citext('email').notNull().unique('usuario_email_key'),
    emailVerified: boolean('email_verificado').notNull().default(false),
    image: text('imagem'),
    role: text('papel').notNull(),
    /** `twoFactorEnabled` do plugin de 2FA (TOTP). */
    mfaEnabled: boolean('mfa_ativo').notNull().default(false),
    isActive: boolean('ativo').notNull().default(true),
    createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'usuario_conta_id_fkey', columns: [t.tenantId], foreignColumns: [tenants.id] }),
    foreignKey({
      name: 'usuario_colaborador_id_fkey',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }),
    unique('usuario_conta_id_id_key').on(t.tenantId, t.id),
    // Seis papéis (04 §1.4, decidido em 18/11/2026)
    check('usuario_papel', sql`papel IN ('admin','rh','gestor','contador','colaborador','super_admin')`),
    check('usuario_conta_obrigatoria', sql`(papel = 'super_admin') = (conta_id IS NULL)`),
    // colaborador é sempre uma pessoa cadastrada; admin e contador podem ser externos
    check('usuario_colaborador_tem_colaborador', sql`papel <> 'colaborador' OR colaborador_id IS NOT NULL`),
    // super_admin sem 2FA: o 2FA só pode ser ativado depois do primeiro login (o segredo
    // TOTP nasce no login), então a regra é da api: sem mfa_ativo, a sessão do super_admin
    // só serve para ativar o 2FA (plugins/request-context.ts). Antes era um CHECK.
  ],
);

// RNF02: escopo por estabelecimento
export const userEstablishments = rh.table(
  'usuarios_estabelecimentos',
  {
    tenantId: tenantId().notNull(),
    userId: ref('usuario_id').notNull(),
    establishmentId: ref('estabelecimento_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'usuario_estabelecimento_pkey', columns: [t.userId, t.establishmentId] }),
    foreignKey({
      name: 'usuario_estabelecimento_usuario_id_fkey',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'usuario_estabelecimento_estabelecimento_id_fkey',
      columns: [t.tenantId, t.establishmentId],
      foreignColumns: [establishments.tenantId, establishments.id],
    }),
  ],
);
