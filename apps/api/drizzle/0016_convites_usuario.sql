CREATE TABLE "rh"."convites_usuario" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."convites_usuario_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint NOT NULL,
	"email" "citext" NOT NULL,
	"nome" text NOT NULL,
	"papel" text NOT NULL,
	"cpf_hash" "bytea" NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"tentativas" smallint DEFAULT 0 NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"aceito_em" timestamp with time zone,
	"usuario_id" bigint,
	"criado_por_id" bigint NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_convites_usuario_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "ck_convites_usuario_papel" CHECK (papel IN ('admin','rh')),
	CONSTRAINT "ck_convites_usuario_status" CHECK (status IN ('pendente','aceito','revogado')),
	CONSTRAINT "ck_convites_usuario_tentativas" CHECK (tentativas BETWEEN 0 AND 5),
	CONSTRAINT "ck_convites_usuario_aceite" CHECK ((status = 'aceito') = (aceito_em IS NOT NULL) AND (status = 'aceito') = (usuario_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "fk_convites_usuario_conta" FOREIGN KEY ("conta_id") REFERENCES "rh"."contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "fk_convites_usuario_usuario" FOREIGN KEY ("conta_id","usuario_id") REFERENCES "rh"."usuarios"("conta_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."convites_usuario" ADD CONSTRAINT "fk_convites_usuario_criado_por" FOREIGN KEY ("criado_por_id") REFERENCES "rh"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_convites_usuario_pendente" ON "rh"."convites_usuario" USING btree ("conta_id","email") WHERE status = 'pendente';--> statement-breakpoint
CREATE INDEX "idx_convites_usuario_conta" ON "rh"."convites_usuario" USING btree ("conta_id","criado_em" DESC NULLS LAST);