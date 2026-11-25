CREATE TABLE "rh"."tentativas_login" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."tentativas_login_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"usuario_id" bigint,
	"email_hash" "bytea" NOT NULL,
	"endereco_ip" text,
	"agente_usuario" text,
	"etapa" text NOT NULL,
	"eh_sucesso" boolean NOT NULL,
	"motivo" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tentativa_login_etapa" CHECK (etapa IN ('senha','totp')),
	CONSTRAINT "tentativa_login_motivo" CHECK (motivo IS NULL OR motivo IN ('credencial_invalida','usuario_inativo','conta_suspensa','totp_invalido')),
	CONSTRAINT "tentativa_login_coerente" CHECK (eh_sucesso = (motivo IS NULL))
);
--> statement-breakpoint
ALTER TABLE "rh"."contas" ADD COLUMN "motivo_suspensao" text;--> statement-breakpoint
ALTER TABLE "rh"."contas" ADD COLUMN "suspensa_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rh"."contas" ADD COLUMN "suspensa_por_id" bigint;--> statement-breakpoint
ALTER TABLE "rh"."contas" ADD COLUMN "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."tentativas_login" ADD CONSTRAINT "tentativa_login_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "rh"."contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."tentativas_login" ADD CONSTRAINT "tentativa_login_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "rh"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tentativa_login_ip" ON "rh"."tentativas_login" USING btree ("endereco_ip","criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_tentativa_login_criado" ON "rh"."tentativas_login" USING btree ("criado_em" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_auditoria_usuario" ON "rh"."auditorias" USING btree ("usuario_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sessao_conta" ON "rh"."sessoes" USING btree ("conta_id","expira_em" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "rh"."contas" ADD CONSTRAINT "conta_suspensao_coerente" CHECK (ativo = (suspensa_em IS NULL) AND (ativo OR motivo_suspensao IS NOT NULL));