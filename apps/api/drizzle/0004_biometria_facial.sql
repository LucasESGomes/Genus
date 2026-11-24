CREATE TABLE "rh"."consentimentos_biometricos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."consentimentos_biometricos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"versao_texto" text NOT NULL,
	"consentido_em" timestamp with time zone NOT NULL,
	"endereco_ip" "inet",
	"aparelho_id" bigint,
	"coletado_por_id" bigint,
	"revogado_em" timestamp with time zone,
	"motivo_revogacao" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consentimento_conta_colab_id_key" UNIQUE("conta_id","colaborador_id","id"),
	CONSTRAINT "consentimento_revogacao_par" CHECK ((revogado_em IS NULL) = (motivo_revogacao IS NULL)),
	CONSTRAINT "consentimento_revogacao_data" CHECK (revogado_em IS NULL OR revogado_em >= consentido_em)
);
--> statement-breakpoint
CREATE TABLE "rh"."chaves_empresa" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."chaves_empresa_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"empresa_id" bigint NOT NULL,
	"versao_chave" integer NOT NULL,
	"dek_iv" "bytea" NOT NULL,
	"dek_tag" "bytea" NOT NULL,
	"dek_ct" "bytea" NOT NULL,
	"versao_kek" integer DEFAULT 1 NOT NULL,
	"eh_ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chave_empresa_versao_key" UNIQUE("empresa_id","versao_chave"),
	CONSTRAINT "chave_empresa_conta_versao_key" UNIQUE("conta_id","empresa_id","versao_chave"),
	CONSTRAINT "chave_empresa_versao_pos" CHECK (versao_chave >= 1 AND versao_kek >= 1),
	CONSTRAINT "chave_empresa_tamanhos" CHECK (octet_length(dek_iv) = 12 AND octet_length(dek_tag) = 16 AND octet_length(dek_ct) = 32)
);
--> statement-breakpoint
CREATE TABLE "rh"."embeddings_faciais" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."embeddings_faciais_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"colaborador_id" bigint NOT NULL,
	"empresa_id" bigint NOT NULL,
	"consentimento_id" bigint NOT NULL,
	"versao_chave" integer NOT NULL,
	"embedding_iv" "bytea" NOT NULL,
	"embedding_tag" "bytea" NOT NULL,
	"embedding_ct" "bytea" NOT NULL,
	"versao_modelo" text NOT NULL,
	"qtd_imagens" smallint NOT NULL,
	"origem" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_colaborador_key" UNIQUE("conta_id","colaborador_id"),
	CONSTRAINT "embedding_tamanhos" CHECK (octet_length(embedding_iv) = 12 AND octet_length(embedding_tag) = 16 AND octet_length(embedding_ct) = 2048),
	CONSTRAINT "embedding_qtd_imagens" CHECK (qtd_imagens BETWEEN 1 AND 5),
	CONSTRAINT "embedding_origem" CHECK (origem IN ('quiosque','portal'))
);
--> statement-breakpoint
ALTER TABLE "rh"."consentimentos_biometricos" ADD CONSTRAINT "consentimento_colaborador_id_fkey" FOREIGN KEY ("conta_id","colaborador_id") REFERENCES "rh"."colaboradores"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."consentimentos_biometricos" ADD CONSTRAINT "consentimento_aparelho_id_fkey" FOREIGN KEY ("conta_id","aparelho_id") REFERENCES "rh"."aparelhos"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."consentimentos_biometricos" ADD CONSTRAINT "consentimento_coletado_por_id_fkey" FOREIGN KEY ("conta_id","coletado_por_id") REFERENCES "rh"."usuarios"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."chaves_empresa" ADD CONSTRAINT "chave_empresa_empresa_id_fkey" FOREIGN KEY ("conta_id","empresa_id") REFERENCES "rh"."empresas"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."embeddings_faciais" ADD CONSTRAINT "embedding_consentimento_fkey" FOREIGN KEY ("conta_id","colaborador_id","consentimento_id") REFERENCES "rh"."consentimentos_biometricos"("conta_id","colaborador_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."embeddings_faciais" ADD CONSTRAINT "embedding_chave_empresa_fkey" FOREIGN KEY ("conta_id","empresa_id","versao_chave") REFERENCES "rh"."chaves_empresa"("conta_id","empresa_id","versao_chave") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_consentimento_ativo" ON "rh"."consentimentos_biometricos" USING btree ("colaborador_id") WHERE revogado_em IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chave_empresa_ativa" ON "rh"."chaves_empresa" USING btree ("empresa_id") WHERE eh_ativa;--> statement-breakpoint
CREATE INDEX "idx_embedding_empresa" ON "rh"."embeddings_faciais" USING btree ("empresa_id");