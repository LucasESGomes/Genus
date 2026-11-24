-- RF21: a apuração (timesheets/rules/day.ts) também sinaliza marcação duplicada, fora de
-- ordem (por NSR) e fora da escala (trabalho em dia de férias ou afastamento). Só amplia o
-- CHECK: os 5 valores anteriores continuam valendo e nenhuma linha muda.
-- Reverter: recriar o CHECK com os 5 valores (falha se já houver linha com os novos).
ALTER TABLE "rh"."inconsistencias" DROP CONSTRAINT "inconsistencia_tipo";--> statement-breakpoint
ALTER TABLE "rh"."inconsistencias" ADD CONSTRAINT "inconsistencia_tipo" CHECK (tipo IN ('batida_faltando','batidas_impares','interjornada_menor_11h','extra_acima_2h','intervalo_nao_cumprido','marcacao_duplicada','marcacao_fora_de_ordem','marcacao_fora_da_escala'));