CREATE TABLE "rh"."chaves_jwt" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."chaves_jwt_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"chave_publica" text NOT NULL,
	"chave_privada" text NOT NULL,
	"algoritmo" text,
	"curva" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rh"."credenciais_login" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."credenciais_login_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"usuario_id" bigint NOT NULL,
	"conta_provedor_id" text NOT NULL,
	"provedor" text NOT NULL,
	"token_acesso" text,
	"token_renovacao" text,
	"token_id" text,
	"token_acesso_expira_em" timestamp with time zone,
	"token_renovacao_expira_em" timestamp with time zone,
	"escopo" text,
	"senha_hash" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credencial_provedor_key" UNIQUE("provedor","conta_provedor_id")
);
--> statement-breakpoint
CREATE TABLE "rh"."sessoes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."sessoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"usuario_id" bigint NOT NULL,
	"token" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"endereco_ip" text,
	"agente_usuario" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessao_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "rh"."dois_fatores" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."dois_fatores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"conta_id" bigint,
	"usuario_id" bigint NOT NULL,
	"segredo" text NOT NULL,
	"codigos_backup" text NOT NULL,
	"verificado" boolean DEFAULT true NOT NULL,
	"tentativas_falhas" integer DEFAULT 0 NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	CONSTRAINT "dois_fatores_usuario_key" UNIQUE("usuario_id")
);
--> statement-breakpoint
CREATE TABLE "rh"."verificacoes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rh"."verificacoes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"identificador" text NOT NULL,
	"valor" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rh"."usuarios" DROP CONSTRAINT "usuario_funcionario_tem_colaborador";--> statement-breakpoint
ALTER TABLE "rh"."usuarios" DROP CONSTRAINT "usuario_super_admin_mfa";--> statement-breakpoint
ALTER TABLE "rh"."usuarios" DROP CONSTRAINT "usuario_papel";--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ALTER COLUMN "senha_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD COLUMN "nome" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD COLUMN "email_verificado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD COLUMN "imagem" text;--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD COLUMN "criado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD COLUMN "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."credenciais_login" ADD CONSTRAINT "credenciais_login_conta_id_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "rh"."contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."credenciais_login" ADD CONSTRAINT "credenciais_login_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "rh"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."sessoes" ADD CONSTRAINT "sessoes_conta_id_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "rh"."contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."sessoes" ADD CONSTRAINT "sessoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "rh"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."dois_fatores" ADD CONSTRAINT "dois_fatores_conta_id_contas_id_fk" FOREIGN KEY ("conta_id") REFERENCES "rh"."contas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rh"."dois_fatores" ADD CONSTRAINT "dois_fatores_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "rh"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credencial_usuario" ON "rh"."credenciais_login" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "idx_sessao_usuario" ON "rh"."sessoes" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "idx_dois_fatores_segredo" ON "rh"."dois_fatores" USING btree ("segredo");--> statement-breakpoint
CREATE INDEX "idx_verificacao_identificador" ON "rh"."verificacoes" USING btree ("identificador");--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD CONSTRAINT "usuario_colaborador_tem_colaborador" CHECK (papel <> 'colaborador' OR colaborador_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE "rh"."usuarios" ADD CONSTRAINT "usuario_papel" CHECK (papel IN ('admin','rh','gestor','contador','colaborador','super_admin'));