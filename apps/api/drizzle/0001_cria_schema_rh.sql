CREATE SCHEMA "rh";
--> statement-breakpoint
CREATE TABLE "rh"."empresa" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."empresa_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"razao_social" text NOT NULL,
	"cnpj" char(14) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresa_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "empresa_cnpj_unico" UNIQUE("conta_id","cnpj"),
	CONSTRAINT "empresa_cnpj_formato" CHECK (cnpj ~ '^[0-9]{14}$')
);
--> statement-breakpoint
CREATE TABLE "rh"."centro_custo" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."centro_custo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"empresa_id" bigint NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	CONSTRAINT "centro_custo_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "cc_codigo_unico" UNIQUE("empresa_id","codigo")
);
--> statement-breakpoint
CREATE TABLE "rh"."setor" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."setor_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	"nome" text NOT NULL,
	"limite_ferias_simultaneas" smallint DEFAULT 1 NOT NULL,
	CONSTRAINT "setor_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "setor_nome_unico" UNIQUE("estabelecimento_id","nome"),
	CONSTRAINT "setor_limite_positivo" CHECK (limite_ferias_simultaneas >= 1)
);
--> statement-breakpoint
CREATE TABLE "rh"."aparelho" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."aparelho_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aparelho_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "aparelho_nome_unico" UNIQUE("estabelecimento_id","nome")
);
--> statement-breakpoint
CREATE TABLE "rh"."colaborador_vinculo" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."colaborador_vinculo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"cargo_id" bigint NOT NULL,
	"setor_id" bigint NOT NULL,
	"centro_custo_id" bigint,
	"tipo_contrato" text NOT NULL,
	"salario_base" numeric(12, 2),
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	CONSTRAINT "vinculo_tipo_contrato" CHECK (tipo_contrato IN ('indeterminado','determinado','safra','intermitente')),
	CONSTRAINT "vinculo_salario_pos" CHECK (salario_base IS NULL OR salario_base > 0),
	CONSTRAINT "vinculo_vigencia" CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
--> statement-breakpoint
CREATE TABLE "rh"."colaborador" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."colaborador_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	"cpf" char(11) NOT NULL,
	"nome" text NOT NULL,
	"matricula" text,
	"data_nascimento" date NOT NULL,
	"data_admissao" date NOT NULL,
	"data_desligamento" date,
	"motivo_desligamento" text,
	"gestor_id" bigint,
	CONSTRAINT "colaborador_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "colaborador_cpf_unico" UNIQUE("conta_id","cpf"),
	CONSTRAINT "colab_matricula_unica" UNIQUE("estabelecimento_id","matricula"),
	CONSTRAINT "colab_cpf_formato" CHECK (cpf ~ '^[0-9]{11}$'),
	CONSTRAINT "colab_admissao_valida" CHECK (data_admissao > data_nascimento),
	CONSTRAINT "colab_desligamento" CHECK (data_desligamento IS NULL OR data_desligamento >= data_admissao),
	CONSTRAINT "colab_motivo_par" CHECK ((data_desligamento IS NULL) = (motivo_desligamento IS NULL)),
	CONSTRAINT "colab_nao_gestor_si" CHECK (gestor_id IS DISTINCT FROM id)
);
--> statement-breakpoint
CREATE TABLE "rh"."estabelecimento" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."estabelecimento_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"empresa_id" bigint NOT NULL,
	"nome" text NOT NULL,
	"tipo_inscricao" text NOT NULL,
	"inscricao" text NOT NULL,
	"uf" char(2) NOT NULL,
	"municipio_ibge" char(7) NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "estabelecimento_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "estab_inscricao_unica" UNIQUE("empresa_id","inscricao"),
	CONSTRAINT "estab_tipo_inscricao" CHECK (tipo_inscricao IN ('CNPJ','CPF','CAEPF')),
	CONSTRAINT "estab_uf_formato" CHECK (uf ~ '^[A-Z]{2}$'),
	CONSTRAINT "estab_ibge_formato" CHECK (municipio_ibge ~ '^[0-9]{7}$')
);
--> statement-breakpoint
CREATE TABLE "rh"."cargo" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."cargo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"empresa_id" bigint NOT NULL,
	"nome" text NOT NULL,
	"cbo" char(6),
	CONSTRAINT "cargo_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "cargo_nome_unico" UNIQUE("empresa_id","nome"),
	CONSTRAINT "cargo_cbo_formato" CHECK (cbo IS NULL OR cbo ~ '^[0-9]{6}$')
);
--> statement-breakpoint
CREATE TABLE "rh"."conta" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."conta_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rh"."usuario_estabelecimento" (
	"conta_id" bigint NOT NULL,
	"usuario_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	CONSTRAINT "usuario_estabelecimento_pkey" PRIMARY KEY("usuario_id","estabelecimento_id")
);
--> statement-breakpoint
CREATE TABLE "rh"."usuario" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."usuario_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"colaborador_id" bigint,
	"email" "citext" NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" text NOT NULL,
	"mfa_ativo" boolean DEFAULT false NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "usuario_colaborador_id_key" UNIQUE("colaborador_id"),
	CONSTRAINT "usuario_email_key" UNIQUE("email"),
	CONSTRAINT "usuario_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "usuario_papel" CHECK (papel IN ('admin','rh','gestor','contador','funcionario','super_admin')),
	CONSTRAINT "usuario_conta_obrigatoria" CHECK ((papel = 'super_admin') = (conta_id IS NULL)),
	CONSTRAINT "usuario_funcionario_tem_colaborador" CHECK (papel <> 'funcionario' OR colaborador_id IS NOT NULL),
	CONSTRAINT "usuario_super_admin_mfa" CHECK (papel <> 'super_admin' OR mfa_ativo)
);
--> statement-breakpoint
CREATE TABLE "rh"."colaborador_escala" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."colaborador_escala_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"escala_id" bigint NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	CONSTRAINT "colab_escala_vigencia" CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
--> statement-breakpoint
CREATE TABLE "rh"."estabelecimento_feriado" (
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	"feriado_id" bigint NOT NULL,
	"trabalha" boolean DEFAULT false NOT NULL,
	"tratamento" text,
	CONSTRAINT "estabelecimento_feriado_pkey" PRIMARY KEY("estabelecimento_id","feriado_id"),
	CONSTRAINT "estab_fer_tratamento" CHECK (tratamento IS NULL OR tratamento IN ('pagar_100','banco_horas')),
	CONSTRAINT "estab_fer_coerente" CHECK ((NOT trabalha AND tratamento IS NULL) OR (trabalha AND tratamento IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."feriado" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."feriado_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"abrangencia" text NOT NULL,
	"uf" char(2),
	"municipio_ibge" char(7),
	"data" date NOT NULL,
	"nome" text NOT NULL,
	"facultativo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "feriado_unico" UNIQUE NULLS NOT DISTINCT("conta_id","data","abrangencia","uf","municipio_ibge"),
	CONSTRAINT "feriado_abrangencia" CHECK (abrangencia IN ('nacional','estadual','municipal')),
	CONSTRAINT "feriado_escopo" CHECK ((abrangencia = 'nacional' AND uf IS NULL AND municipio_ibge IS NULL) OR (abrangencia = 'estadual' AND uf IS NOT NULL AND municipio_ibge IS NULL) OR (abrangencia = 'municipal' AND uf IS NOT NULL AND municipio_ibge IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."parametro_legal" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."parametro_legal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"empresa_id" bigint,
	"chave" text NOT NULL,
	"valor" jsonb NOT NULL,
	"base_legal" text,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	CONSTRAINT "param_empresa_tem_conta" CHECK (empresa_id IS NULL OR conta_id IS NOT NULL),
	CONSTRAINT "param_vigencia" CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
--> statement-breakpoint
CREATE TABLE "rh"."escala_dia" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."escala_dia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"escala_id" bigint NOT NULL,
	"posicao" smallint NOT NULL,
	"folga" boolean DEFAULT false NOT NULL,
	"entrada" time,
	"saida" time,
	"intervalo_inicio" time,
	"intervalo_fim" time,
	"vira_dia" boolean DEFAULT false NOT NULL,
	CONSTRAINT "escala_dia_unico" UNIQUE("escala_id","posicao"),
	CONSTRAINT "escala_dia_posicao" CHECK (posicao >= 0),
	CONSTRAINT "escala_dia_horario" CHECK ((folga AND entrada IS NULL AND saida IS NULL) OR (NOT folga AND entrada IS NOT NULL AND saida IS NOT NULL)),
	CONSTRAINT "escala_dia_intervalo" CHECK ((intervalo_inicio IS NULL AND intervalo_fim IS NULL) OR (intervalo_inicio IS NOT NULL AND intervalo_fim IS NOT NULL AND intervalo_inicio < intervalo_fim))
);
--> statement-breakpoint
CREATE TABLE "rh"."troca_turno" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."troca_turno_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"data" date NOT NULL,
	"folga" boolean DEFAULT false NOT NULL,
	"entrada" time,
	"saida" time,
	"motivo" text NOT NULL,
	"criado_por" bigint NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "troca_unica" UNIQUE("colaborador_id","data"),
	CONSTRAINT "troca_horario" CHECK ((folga AND entrada IS NULL AND saida IS NULL) OR (NOT folga AND entrada IS NOT NULL AND saida IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."escala" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."escala_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"ciclo_tipo" text NOT NULL,
	"ciclo_dias" smallint,
	"data_referencia" date,
	"carga_semanal_min" integer NOT NULL,
	CONSTRAINT "escala_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "escala_tipo" CHECK (tipo IN ('5x2','6x1','12x36','livre')),
	CONSTRAINT "escala_ciclo_tipo" CHECK (ciclo_tipo IN ('semanal','ciclico')),
	CONSTRAINT "escala_carga_pos" CHECK (carga_semanal_min > 0),
	CONSTRAINT "escala_ciclo_dias" CHECK (ciclo_dias IS NULL OR ciclo_dias BETWEEN 2 AND 60),
	CONSTRAINT "escala_ciclo_coerente" CHECK ((ciclo_tipo = 'semanal' AND ciclo_dias IS NULL AND data_referencia IS NULL) OR (ciclo_tipo = 'ciclico' AND ciclo_dias IS NOT NULL AND data_referencia IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."apuracao_dia" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."apuracao_dia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"data" date NOT NULL,
	"escala_id" bigint,
	"situacao" text NOT NULL,
	"minutos_previstos" integer DEFAULT 0 NOT NULL,
	"minutos_trabalhados" integer DEFAULT 0 NOT NULL,
	"minutos_falta" integer DEFAULT 0 NOT NULL,
	"minutos_atraso" integer DEFAULT 0 NOT NULL,
	"minutos_extra_50" integer DEFAULT 0 NOT NULL,
	"minutos_extra_100" integer DEFAULT 0 NOT NULL,
	"minutos_noturno" integer DEFAULT 0 NOT NULL,
	"minutos_intervalo" integer DEFAULT 0 NOT NULL,
	"dsr_descontado" boolean DEFAULT false NOT NULL,
	"parametro_versao" text NOT NULL,
	"calculado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apuracao_dia_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "apuracao_dia_unico" UNIQUE("colaborador_id","data"),
	CONSTRAINT "apuracao_situacao" CHECK (situacao IN ('normal','falta','folga','feriado','ferias','afastamento')),
	CONSTRAINT "apuracao_minutos_nao_negativos" CHECK (minutos_previstos >= 0 AND minutos_trabalhados >= 0 AND minutos_falta >= 0 AND minutos_atraso >= 0 AND minutos_extra_50 >= 0 AND minutos_extra_100 >= 0 AND minutos_noturno >= 0 AND minutos_intervalo >= 0),
	CONSTRAINT "apuracao_noturno_cabe" CHECK (minutos_noturno <= minutos_trabalhados)
);
--> statement-breakpoint
CREATE TABLE "rh"."inconsistencia" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."inconsistencia_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"apuracao_dia_id" bigint NOT NULL,
	"tipo" text NOT NULL,
	"resolvida" boolean DEFAULT false NOT NULL,
	"resolvida_por" bigint,
	"resolvida_em" timestamp with time zone,
	CONSTRAINT "inconsistencia_unica" UNIQUE("apuracao_dia_id","tipo"),
	CONSTRAINT "inconsistencia_tipo" CHECK (tipo IN ('batida_faltando','batidas_impares','interjornada_menor_11h','extra_acima_2h','intervalo_nao_cumprido')),
	CONSTRAINT "inconsistencia_resolucao" CHECK ((NOT resolvida AND resolvida_por IS NULL AND resolvida_em IS NULL) OR (resolvida AND resolvida_por IS NOT NULL AND resolvida_em IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."apuracao_marcacao" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."apuracao_marcacao_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"apuracao_dia_id" bigint NOT NULL,
	"sequencia" smallint NOT NULL,
	"hora" timestamp with time zone NOT NULL,
	"origem" text NOT NULL,
	"nsr" bigint,
	"ajuste_id" bigint,
	CONSTRAINT "marcacao_unica" UNIQUE("apuracao_dia_id","sequencia"),
	CONSTRAINT "marcacao_origem" CHECK (origem IN ('original','tratada')),
	CONSTRAINT "marcacao_sequencia" CHECK (sequencia > 0),
	CONSTRAINT "marcacao_procedencia" CHECK ((origem = 'original' AND nsr IS NOT NULL AND ajuste_id IS NULL) OR (origem = 'tratada' AND nsr IS NULL AND ajuste_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."afastamento" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."afastamento_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"tipo" text NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date NOT NULL,
	"atestado_id" bigint,
	CONSTRAINT "afastamento_atestado_id_key" UNIQUE("atestado_id"),
	CONSTRAINT "afast_tipo" CHECK (tipo IN ('atestado','maternidade','paternidade','casamento','obito','doacao_sangue','alistamento','inss','outro')),
	CONSTRAINT "afast_periodo" CHECK (data_fim >= data_inicio),
	CONSTRAINT "afast_atestado_coerente" CHECK ((tipo = 'atestado' AND atestado_id IS NOT NULL) OR (tipo <> 'atestado' AND atestado_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."atestado_analise" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."atestado_analise_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"atestado_id" bigint NOT NULL,
	"ocr_texto_cifrado" "bytea",
	"score" smallint NOT NULL,
	"nota_risco" text NOT NULL,
	"motivos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analisado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "atestado_analise_atestado_id_key" UNIQUE("atestado_id"),
	CONSTRAINT "analise_nota" CHECK (nota_risco IN ('baixo','medio','alto')),
	CONSTRAINT "analise_score" CHECK (score BETWEEN 0 AND 100),
	CONSTRAINT "analise_motivos" CHECK (jsonb_typeof(motivos) = 'array')
);
--> statement-breakpoint
CREATE TABLE "rh"."atestado" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."atestado_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"data_inicio" date NOT NULL,
	"dias" smallint,
	"horas" smallint,
	"arquivo_url" text NOT NULL,
	"arquivo_hash" char(64) NOT NULL,
	"medico_nome" text,
	"medico_crm" text,
	"medico_crm_uf" char(2),
	"cid_cifrado" "bytea",
	"status" text DEFAULT 'pendente' NOT NULL,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_por" bigint,
	"decidido_em" timestamp with time zone,
	"motivo_decisao" text,
	CONSTRAINT "atestado_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "atestado_arquivo_unico" UNIQUE("colaborador_id","arquivo_hash"),
	CONSTRAINT "atestado_status" CHECK (status IN ('pendente','aprovado','recusado')),
	CONSTRAINT "atestado_duracao" CHECK (num_nonnulls(dias, horas) = 1),
	CONSTRAINT "atestado_dias_pos" CHECK (dias IS NULL OR dias > 0),
	CONSTRAINT "atestado_horas_pos" CHECK (horas IS NULL OR horas > 0),
	CONSTRAINT "atestado_crm_uf" CHECK (medico_crm_uf IS NULL OR medico_crm_uf ~ '^[A-Z]{2}$'),
	CONSTRAINT "atestado_decisao_coerente" CHECK ((status = 'pendente' AND decidido_por IS NULL AND decidido_em IS NULL) OR (status <> 'pendente' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)),
	CONSTRAINT "atestado_recusa_com_motivo" CHECK (status <> 'recusado' OR motivo_decisao IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "rh"."ajuste" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."ajuste_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"data" date NOT NULL,
	"tipo" text NOT NULL,
	"hora_proposta" timestamp with time zone,
	"motivo" text NOT NULL,
	"anexo_url" text,
	"status" text DEFAULT 'pendente' NOT NULL,
	"solicitado_por" bigint NOT NULL,
	"solicitado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_por" bigint,
	"decidido_em" timestamp with time zone,
	"motivo_decisao" text,
	CONSTRAINT "ajuste_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "ajuste_tipo" CHECK (tipo IN ('inclusao_batida','justificativa','abono')),
	CONSTRAINT "ajuste_status" CHECK (status IN ('pendente','aprovado','recusado')),
	CONSTRAINT "ajuste_hora_obrigatoria" CHECK (tipo <> 'inclusao_batida' OR hora_proposta IS NOT NULL),
	CONSTRAINT "ajuste_decisao_coerente" CHECK ((status = 'pendente' AND decidido_por IS NULL AND decidido_em IS NULL) OR (status <> 'pendente' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)),
	CONSTRAINT "ajuste_recusa_com_motivo" CHECK (status <> 'recusado' OR motivo_decisao IS NOT NULL),
	CONSTRAINT "ajuste_decisor_diferente" CHECK (decidido_por IS NULL OR decidido_por <> solicitado_por)
);
--> statement-breakpoint
CREATE TABLE "rh"."banco_horas_lancamento" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."banco_horas_lancamento_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"apuracao_dia_id" bigint,
	"tipo" text NOT NULL,
	"minutos" integer NOT NULL,
	"data_competencia" date NOT NULL,
	"data_vencimento" date,
	"criado_por" bigint NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bh_tipo" CHECK (tipo IN ('credito','debito','folga_compensatoria','pagamento','desconto','expiracao')),
	CONSTRAINT "bh_minutos_nao_zero" CHECK (minutos <> 0),
	CONSTRAINT "bh_sinal_coerente" CHECK ((tipo = 'credito' AND minutos > 0) OR (tipo <> 'credito' AND minutos < 0)),
	CONSTRAINT "bh_vencimento" CHECK (data_vencimento IS NULL OR data_vencimento > data_competencia)
);
--> statement-breakpoint
CREATE TABLE "rh"."banco_horas_regra" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."banco_horas_regra_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint,
	"colaborador_id" bigint,
	"modalidade" text NOT NULL,
	"peso_domingo" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"peso_feriado" numeric(3, 2) DEFAULT '1.00' NOT NULL,
	"vigencia_inicio" date NOT NULL,
	"vigencia_fim" date,
	CONSTRAINT "bh_regra_modalidade" CHECK (modalidade IN ('individual_6m','coletivo_12m')),
	CONSTRAINT "bh_regra_pesos" CHECK (peso_domingo >= 1 AND peso_feriado >= 1),
	CONSTRAINT "bh_regra_escopo" CHECK (num_nonnulls(estabelecimento_id, colaborador_id) = 1),
	CONSTRAINT "bh_regra_vigencia" CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio)
);
--> statement-breakpoint
CREATE TABLE "rh"."ferias_periodo_aquisitivo" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."ferias_periodo_aquisitivo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"concessivo_fim" date NOT NULL,
	"faltas_injustificadas" smallint DEFAULT 0 NOT NULL,
	"dias_direito" smallint NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	CONSTRAINT "ferias_periodo_aquisitivo_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "pa_periodo" CHECK (fim > inicio),
	CONSTRAINT "pa_concessivo" CHECK (concessivo_fim > fim),
	CONSTRAINT "pa_faltas" CHECK (faltas_injustificadas >= 0),
	CONSTRAINT "pa_status" CHECK (status IN ('aberto','concluido','vencido')),
	CONSTRAINT "pa_dias_direito" CHECK (dias_direito IN (0,12,18,24,30)),
	CONSTRAINT "pa_direito_bate_faltas" CHECK (dias_direito = CASE WHEN faltas_injustificadas <= 5 THEN 30 WHEN faltas_injustificadas <= 14 THEN 24 WHEN faltas_injustificadas <= 23 THEN 18 WHEN faltas_injustificadas <= 32 THEN 12 ELSE 0 END)
);
--> statement-breakpoint
CREATE TABLE "rh"."ferias_gozo" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."ferias_gozo_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"periodo_aquisitivo_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"setor_id" bigint NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date NOT NULL,
	"dias" smallint GENERATED ALWAYS AS (data_fim - data_inicio + 1) STORED,
	"abono_pecuniario_dias" smallint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"solicitado_por" bigint NOT NULL,
	"solicitado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_por" bigint,
	"decidido_em" timestamp with time zone,
	"motivo_decisao" text,
	CONSTRAINT "fg_periodo" CHECK (data_fim >= data_inicio),
	CONSTRAINT "fg_status" CHECK (status IN ('solicitada','aprovada','recusada','cancelada','gozada')),
	CONSTRAINT "fg_minimo_5_dias" CHECK (data_fim - data_inicio + 1 >= 5),
	CONSTRAINT "fg_abono" CHECK (abono_pecuniario_dias BETWEEN 0 AND 10),
	CONSTRAINT "fg_decisao_coerente" CHECK ((status = 'solicitada' AND decidido_por IS NULL AND decidido_em IS NULL) OR (status <> 'solicitada' AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL)),
	CONSTRAINT "fg_recusa_com_motivo" CHECK (status <> 'recusada' OR motivo_decisao IS NOT NULL),
	CONSTRAINT "fg_decisor_diferente" CHECK (decidido_por IS NULL OR decidido_por <> solicitado_por)
);
--> statement-breakpoint
CREATE TABLE "rh"."auditoria" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."auditoria_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"usuario_id" bigint,
	"entidade" text NOT NULL,
	"entidade_id" bigint NOT NULL,
	"acao" text NOT NULL,
	"dados_antes" jsonb,
	"dados_depois" jsonb,
	"motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auditoria_acao" CHECK (acao IN ('criacao','alteracao','exclusao','leitura_sensivel','aprovacao','recusa','fechamento','reabertura'))
);
--> statement-breakpoint
CREATE TABLE "rh"."fechamento" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."fechamento_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"estabelecimento_id" bigint NOT NULL,
	"competencia" date NOT NULL,
	"data_inicio" date NOT NULL,
	"data_fim" date NOT NULL,
	"status" text DEFAULT 'aberto' NOT NULL,
	"fechado_por" bigint,
	"fechado_em" timestamp with time zone,
	"reaberto_por" bigint,
	"reaberto_em" timestamp with time zone,
	"motivo_reabertura" text,
	CONSTRAINT "fechamento_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "fech_unico" UNIQUE("estabelecimento_id","competencia"),
	CONSTRAINT "fech_periodo" CHECK (data_fim >= data_inicio),
	CONSTRAINT "fech_status" CHECK (status IN ('aberto','fechado','reaberto')),
	CONSTRAINT "fech_competencia_dia_1" CHECK (extract(day FROM competencia) = 1),
	CONSTRAINT "fech_fechado_coerente" CHECK ((status = 'aberto' AND fechado_por IS NULL) OR (status <> 'aberto' AND fechado_por IS NOT NULL AND fechado_em IS NOT NULL)),
	CONSTRAINT "fech_reabertura_coerente" CHECK (status <> 'reaberto' OR (reaberto_por IS NOT NULL AND reaberto_em IS NOT NULL AND motivo_reabertura IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "rh"."espelho" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."espelho_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"fechamento_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"pdf_url" text,
	"ciencia_em" timestamp with time zone,
	"ciencia_ip" "inet",
	CONSTRAINT "espelho_unico" UNIQUE("fechamento_id","colaborador_id"),
	CONSTRAINT "espelho_ciencia" CHECK ((ciencia_em IS NULL) = (ciencia_ip IS NULL))
);
--> statement-breakpoint
ALTER TABLE "rh"."empresa" ADD CONSTRAINT "empresa_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "rh"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."centro_custo" ADD CONSTRAINT "centro_custo_empresa_id_fkey" FOREIGN KEY ("conta_id","empresa_id") REFERENCES "rh"."empresa"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."setor" ADD CONSTRAINT "setor_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."aparelho" ADD CONSTRAINT "aparelho_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador_vinculo" ADD CONSTRAINT "colaborador_vinculo_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador_vinculo" ADD CONSTRAINT "colaborador_vinculo_cargo_id_fkey" FOREIGN KEY ("conta_id","cargo_id") REFERENCES "rh"."cargo"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador_vinculo" ADD CONSTRAINT "colaborador_vinculo_setor_id_fkey" FOREIGN KEY ("conta_id","setor_id") REFERENCES "rh"."setor"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador_vinculo" ADD CONSTRAINT "colaborador_vinculo_centro_custo_id_fkey" FOREIGN KEY ("conta_id","centro_custo_id") REFERENCES "rh"."centro_custo"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador" ADD CONSTRAINT "colaborador_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador" ADD CONSTRAINT "colaborador_gestor_id_fkey" FOREIGN KEY ("conta_id","gestor_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."estabelecimento" ADD CONSTRAINT "estabelecimento_empresa_id_fkey" FOREIGN KEY ("conta_id","empresa_id") REFERENCES "rh"."empresa"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."cargo" ADD CONSTRAINT "cargo_empresa_id_fkey" FOREIGN KEY ("conta_id","empresa_id") REFERENCES "rh"."empresa"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."usuario_estabelecimento" ADD CONSTRAINT "usuario_estabelecimento_usuario_id_fkey" FOREIGN KEY ("conta_id","usuario_id") REFERENCES "rh"."usuario"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."usuario_estabelecimento" ADD CONSTRAINT "usuario_estabelecimento_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."usuario" ADD CONSTRAINT "usuario_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "rh"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."usuario" ADD CONSTRAINT "usuario_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador_escala" ADD CONSTRAINT "colaborador_escala_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."colaborador_escala" ADD CONSTRAINT "colaborador_escala_escala_id_fkey" FOREIGN KEY ("conta_id","escala_id") REFERENCES "rh"."escala"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."estabelecimento_feriado" ADD CONSTRAINT "estabelecimento_feriado_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."estabelecimento_feriado" ADD CONSTRAINT "estabelecimento_feriado_feriado_id_fkey" FOREIGN KEY ("feriado_id") REFERENCES "rh"."feriado"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."feriado" ADD CONSTRAINT "feriado_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "rh"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."parametro_legal" ADD CONSTRAINT "parametro_legal_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "rh"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."parametro_legal" ADD CONSTRAINT "param_empresa_fk" FOREIGN KEY ("conta_id","empresa_id") REFERENCES "rh"."empresa"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."escala_dia" ADD CONSTRAINT "escala_dia_escala_id_fkey" FOREIGN KEY ("conta_id","escala_id") REFERENCES "rh"."escala"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."troca_turno" ADD CONSTRAINT "troca_turno_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."troca_turno" ADD CONSTRAINT "troca_turno_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."escala" ADD CONSTRAINT "escala_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."apuracao_dia" ADD CONSTRAINT "apuracao_dia_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."apuracao_dia" ADD CONSTRAINT "apuracao_dia_escala_id_fkey" FOREIGN KEY ("conta_id","escala_id") REFERENCES "rh"."escala"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."inconsistencia" ADD CONSTRAINT "inconsistencia_apuracao_dia_id_fkey" FOREIGN KEY ("conta_id","apuracao_dia_id") REFERENCES "rh"."apuracao_dia"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."inconsistencia" ADD CONSTRAINT "inconsistencia_resolvida_por_fkey" FOREIGN KEY ("resolvida_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."apuracao_marcacao" ADD CONSTRAINT "apuracao_marcacao_apuracao_dia_id_fkey" FOREIGN KEY ("conta_id","apuracao_dia_id") REFERENCES "rh"."apuracao_dia"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."apuracao_marcacao" ADD CONSTRAINT "marcacao_ajuste_fk" FOREIGN KEY ("conta_id","ajuste_id") REFERENCES "rh"."ajuste"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."afastamento" ADD CONSTRAINT "afastamento_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."afastamento" ADD CONSTRAINT "afastamento_atestado_id_fkey" FOREIGN KEY ("conta_id","atestado_id") REFERENCES "rh"."atestado"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."atestado_analise" ADD CONSTRAINT "atestado_analise_atestado_id_fkey" FOREIGN KEY ("conta_id","atestado_id") REFERENCES "rh"."atestado"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."atestado" ADD CONSTRAINT "atestado_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."atestado" ADD CONSTRAINT "atestado_decidido_por_fkey" FOREIGN KEY ("decidido_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ajuste" ADD CONSTRAINT "ajuste_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ajuste" ADD CONSTRAINT "ajuste_solicitado_por_fkey" FOREIGN KEY ("solicitado_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ajuste" ADD CONSTRAINT "ajuste_decidido_por_fkey" FOREIGN KEY ("decidido_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."banco_horas_lancamento" ADD CONSTRAINT "banco_horas_lancamento_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."banco_horas_lancamento" ADD CONSTRAINT "banco_horas_lancamento_apuracao_dia_id_fkey" FOREIGN KEY ("conta_id","apuracao_dia_id") REFERENCES "rh"."apuracao_dia"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."banco_horas_lancamento" ADD CONSTRAINT "banco_horas_lancamento_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."banco_horas_regra" ADD CONSTRAINT "banco_horas_regra_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."banco_horas_regra" ADD CONSTRAINT "banco_horas_regra_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ferias_periodo_aquisitivo" ADD CONSTRAINT "ferias_periodo_aquisitivo_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ferias_gozo" ADD CONSTRAINT "ferias_gozo_periodo_aquisitivo_id_fkey" FOREIGN KEY ("conta_id","periodo_aquisitivo_id") REFERENCES "rh"."ferias_periodo_aquisitivo"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ferias_gozo" ADD CONSTRAINT "ferias_gozo_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ferias_gozo" ADD CONSTRAINT "ferias_gozo_setor_id_fkey" FOREIGN KEY ("conta_id","setor_id") REFERENCES "rh"."setor"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ferias_gozo" ADD CONSTRAINT "ferias_gozo_solicitado_por_fkey" FOREIGN KEY ("solicitado_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."ferias_gozo" ADD CONSTRAINT "ferias_gozo_decidido_por_fkey" FOREIGN KEY ("decidido_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."auditoria" ADD CONSTRAINT "auditoria_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "rh"."conta"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."fechamento" ADD CONSTRAINT "fechamento_estabelecimento_id_fkey" FOREIGN KEY ("conta_id","estabelecimento_id") REFERENCES "rh"."estabelecimento"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."fechamento" ADD CONSTRAINT "fechamento_fechado_por_fkey" FOREIGN KEY ("fechado_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."fechamento" ADD CONSTRAINT "fechamento_reaberto_por_fkey" FOREIGN KEY ("reaberto_por") REFERENCES "rh"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."espelho" ADD CONSTRAINT "espelho_fechamento_id_fkey" FOREIGN KEY ("conta_id","fechamento_id") REFERENCES "rh"."fechamento"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."espelho" ADD CONSTRAINT "espelho_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaborador"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vinculo_colab_vigencia" ON "rh"."colaborador_vinculo" USING btree ("colaborador_id","vigencia_inicio" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_colaborador_estab" ON "rh"."colaborador" USING btree ("estabelecimento_id") WHERE data_desligamento IS NULL;--> statement-breakpoint
CREATE INDEX "idx_colaborador_gestor" ON "rh"."colaborador" USING btree ("gestor_id");--> statement-breakpoint
CREATE INDEX "idx_feriado_data" ON "rh"."feriado" USING btree ("data");--> statement-breakpoint
CREATE INDEX "idx_apuracao_colab_data" ON "rh"."apuracao_dia" USING btree ("colaborador_id","data" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_apuracao_data" ON "rh"."apuracao_dia" USING btree ("data");--> statement-breakpoint
CREATE INDEX "idx_marcacao_dia" ON "rh"."apuracao_marcacao" USING btree ("apuracao_dia_id","sequencia");--> statement-breakpoint
CREATE INDEX "idx_atestado_pendente" ON "rh"."atestado" USING btree ("colaborador_id") WHERE status = 'pendente';--> statement-breakpoint
CREATE INDEX "idx_ajuste_pendente" ON "rh"."ajuste" USING btree ("colaborador_id") WHERE status = 'pendente';--> statement-breakpoint
CREATE INDEX "idx_bh_colab" ON "rh"."banco_horas_lancamento" USING btree ("colaborador_id","data_competencia");--> statement-breakpoint
CREATE INDEX "idx_bh_vencimento" ON "rh"."banco_horas_lancamento" USING btree ("data_vencimento") WHERE data_vencimento IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_ferias_setor_periodo" ON "rh"."ferias_gozo" USING btree ("setor_id","data_inicio","data_fim") WHERE status IN ('aprovada','gozada');--> statement-breakpoint
CREATE INDEX "idx_auditoria_entidade" ON "rh"."auditoria" USING btree ("entidade","entidade_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_auditoria_conta" ON "rh"."auditoria" USING btree ("conta_id","criado_em" DESC NULLS LAST);