-- G6 (RF61–RF67, RN15): análise de atestado por regras + IA. A IA só sugere; nenhuma coluna
-- daqui altera o status do atestado (quem decide é o RH, G7).
-- Várias análises por atestado: uma por provedor/modelo/versão do prompt (reanálise e
-- comparação entre modelos). Nenhuma linha existente muda: as colunas novas são nulas ou
-- têm padrão ('regras', 'revisar_manual').
-- Reverter: apagar as linhas extras por atestado, remover colunas/CHECKs/índice e recriar
-- UNIQUE (atestado_id) como atestado_analise_atestado_id_key.
ALTER TABLE "rh"."analises_atestado" DROP CONSTRAINT "atestado_analise_atestado_id_key";--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "provedor" text DEFAULT 'regras' NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "modelo" text;--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "versao_prompt" text;--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "hash_entrada" "bytea";--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "resultado" jsonb;--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "recomendacao" text DEFAULT 'revisar_manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "cid_cifrado" "bytea";--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "evidencias_cifradas" "bytea";--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "milissegundos_resposta" integer;--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD COLUMN "falha" text;--> statement-breakpoint
CREATE INDEX "idx_analise_atestado" ON "rh"."analises_atestado" USING btree ("conta_id","atestado_id","analisado_em" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD CONSTRAINT "analise_provedor" CHECK (provedor IN ('regras','mock','anthropic','openai_compativel'));--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD CONSTRAINT "analise_recomendacao" CHECK (recomendacao IN ('revisar_manual','sem_recomendacao'));--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD CONSTRAINT "analise_resultado" CHECK (resultado IS NULL OR jsonb_typeof(resultado) = 'object');--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD CONSTRAINT "analise_ms" CHECK (milissegundos_resposta IS NULL OR milissegundos_resposta >= 0);--> statement-breakpoint
ALTER TABLE "rh"."analises_atestado" ADD CONSTRAINT "analise_falha_sem_ia" CHECK (falha IS NULL OR resultado IS NULL OR NOT (resultado ? 'checkedFields'));--> statement-breakpoint
COMMENT ON COLUMN rh.analises_atestado.provedor IS 'regras = IA não chamada (barrada pelas regras); mock = simulação determinística; anthropic | openai_compativel = provedor real.';--> statement-breakpoint
COMMENT ON COLUMN rh.analises_atestado.hash_entrada IS 'SHA-256 do texto já sem CPF e nome + versão do prompt. Não é dado de saúde em claro.';--> statement-breakpoint
COMMENT ON COLUMN rh.analises_atestado.resultado IS 'Resumo sem texto livre: situação de cada campo, possibilidades sem CID e confiabilidade indicativa. Saída da IA só depois de validada.';--> statement-breakpoint
COMMENT ON COLUMN rh.analises_atestado.cid_cifrado IS 'CID extraído do texto (dado de saúde, LGPD art. 11): AES-256-GCM na aplicação, só o RH lê.';--> statement-breakpoint
COMMENT ON COLUMN rh.analises_atestado.evidencias_cifradas IS 'Trechos do atestado citados como evidência: AES-256-GCM na aplicação, só o RH lê.';--> statement-breakpoint
COMMENT ON COLUMN rh.analises_atestado.falha IS 'Erro tratado da IA (saida_fora_do_schema, provedor_indisponivel, tempo_esgotado, recusa_do_modelo). Com falha, nada da IA é gravado.';
