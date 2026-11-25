CREATE TABLE "rh"."sessoes_calibracao" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."sessoes_calibracao_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"aparelho_id" bigint NOT NULL,
	"status" text DEFAULT 'aguardando' NOT NULL,
	"iniciada_por_id" bigint NOT NULL,
	"iniciada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"calculada_em" timestamp with time zone,
	"resultado" jsonb,
	"decidida_por_id" bigint,
	"decidida_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessao_calibracao_conta_id_id_key" UNIQUE("conta_id","id"),
	CONSTRAINT "sessao_calibracao_status" CHECK (status IN ('aguardando','calculada','aplicada','descartada','falhou')),
	CONSTRAINT "sessao_calibracao_resultado" CHECK (resultado IS NULL OR jsonb_typeof(resultado) = 'object')
);
--> statement-breakpoint
CREATE TABLE "rh"."eventos_aparelho" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."eventos_aparelho_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"aparelho_id" bigint NOT NULL,
	"tipo" text NOT NULL,
	"descricao" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evento_aparelho_tipo" CHECK (tipo IN ('conexao','chave_regenerada','ativado','desativado','calibracao','cadastro_facial','sincronizacao'))
);
--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "chave_hash" "bytea";--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "chave_prefixo" text;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "chave_gerada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "ultima_conexao_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "versao_app" text;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "limiar_reconhecimento" real;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "limiar_vivacidade" real;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "calibrado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD COLUMN "calibracao_origem_id" bigint;--> statement-breakpoint
ALTER TABLE "rh"."sessoes_calibracao" ADD CONSTRAINT "sessao_calibracao_aparelho_id_fkey" FOREIGN KEY ("conta_id","aparelho_id") REFERENCES "rh"."aparelhos"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."sessoes_calibracao" ADD CONSTRAINT "sessao_calibracao_iniciada_por_id_fkey" FOREIGN KEY ("conta_id","iniciada_por_id") REFERENCES "rh"."usuarios"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."sessoes_calibracao" ADD CONSTRAINT "sessao_calibracao_decidida_por_id_fkey" FOREIGN KEY ("conta_id","decidida_por_id") REFERENCES "rh"."usuarios"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."eventos_aparelho" ADD CONSTRAINT "evento_aparelho_aparelho_id_fkey" FOREIGN KEY ("conta_id","aparelho_id") REFERENCES "rh"."aparelhos"("conta_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessao_calibracao_aberta" ON "rh"."sessoes_calibracao" USING btree ("aparelho_id") WHERE status IN ('aguardando','calculada');--> statement-breakpoint
CREATE INDEX "idx_sessao_calibracao_aparelho" ON "rh"."sessoes_calibracao" USING btree ("conta_id","aparelho_id","iniciada_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_evento_aparelho" ON "rh"."eventos_aparelho" USING btree ("conta_id","aparelho_id","criado_em" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD CONSTRAINT "aparelho_calibracao_origem_fkey" FOREIGN KEY ("conta_id","calibracao_origem_id") REFERENCES "rh"."aparelhos"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD CONSTRAINT "aparelho_chave_hash_key" UNIQUE("chave_hash");--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD CONSTRAINT "aparelho_limiar_reconhecimento" CHECK (limiar_reconhecimento IS NULL OR (limiar_reconhecimento >= 0.5 AND limiar_reconhecimento <= 2.0));--> statement-breakpoint
ALTER TABLE "rh"."aparelhos" ADD CONSTRAINT "aparelho_limiar_vivacidade" CHECK (limiar_vivacidade IS NULL OR (limiar_vivacidade >= 0.5 AND limiar_vivacidade <= 0.95));