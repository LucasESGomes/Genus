-- Totem web (docs/totem-contrato.md §2): regras que o Drizzle não declara.
-- Reverter: DROP TRIGGER trg_evento_aparelho_imutavel e trg_evento_aparelho_sem_truncate ON rh.eventos_aparelho;
-- DROP FUNCTION rh.fn_evento_aparelho_imutavel(); revogar o GRANT do coletor.

-- eventos_aparelho só aceita INSERT. Única exceção: o DELETE em cascata ao apagar o aparelho
-- (que nunca recebeu batida); ele roda dentro do gatilho de integridade referencial
-- (pg_trigger_depth() > 1). DELETE e UPDATE direto continuam recusados.
CREATE OR REPLACE FUNCTION rh.fn_evento_aparelho_imutavel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Evento do aparelho não pode ser alterado nem removido'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_evento_aparelho_imutavel
    BEFORE UPDATE OR DELETE ON rh.eventos_aparelho
    FOR EACH ROW EXECUTE FUNCTION rh.fn_evento_aparelho_imutavel();
--> statement-breakpoint

CREATE TRIGGER trg_evento_aparelho_sem_truncate
    BEFORE TRUNCATE ON rh.eventos_aparelho
    FOR EACH STATEMENT EXECUTE FUNCTION rh.fn_evento_aparelho_imutavel();
--> statement-breakpoint

-- atualizado_em da sessão de calibração
CREATE OR REPLACE FUNCTION rh.fn_sessao_calibracao_atualizado() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_sessao_calibracao_atualizado
    BEFORE UPDATE ON rh.sessoes_calibracao
    FOR EACH ROW EXECUTE FUNCTION rh.fn_sessao_calibracao_atualizado();
--> statement-breakpoint

COMMENT ON COLUMN rh.aparelhos.chave_hash IS 'SHA-256 da chave do totem (gk_ + 40 hex). A chave em claro nunca é gravada.';
--> statement-breakpoint
COMMENT ON COLUMN rh.sessoes_calibracao.resultado IS 'Só números agregados (limiares, nota de qualidade, recomendações, histograma). Nunca imagem nem embedding.';
--> statement-breakpoint

-- Papel de leitura da api do coletor (criado em db/postgres/bootstrap.sh, que roda ANTES das migrations
-- do RH). SELECT só nas colunas que ele usa (nunca pin_hash). Protegido: sem o papel, nada acontece.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genus_coletor_leitura') THEN
        GRANT USAGE ON SCHEMA rh TO genus_coletor_leitura;
        GRANT SELECT (id, conta_id, estabelecimento_id, ativo, chave_hash, limiar_reconhecimento, limiar_vivacidade) ON rh.aparelhos TO genus_coletor_leitura;
        GRANT SELECT (id, conta_id, estabelecimento_id, cpf, nome, data_desligamento) ON rh.colaboradores TO genus_coletor_leitura;
        GRANT SELECT (conta_id, colaborador_id, empresa_id, versao_chave, embedding_iv, embedding_tag, embedding_ct) ON rh.embeddings_faciais TO genus_coletor_leitura;
        GRANT SELECT (conta_id, empresa_id, versao_chave, versao_kek, dek_iv, dek_tag, dek_ct, eh_ativa) ON rh.chaves_empresa TO genus_coletor_leitura;
    END IF;
END $$;
