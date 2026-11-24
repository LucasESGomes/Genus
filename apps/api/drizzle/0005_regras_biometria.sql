-- Regras da biometria facial que o Drizzle não declara: triggers, comentários e
-- permissões. As tabelas estão na 0004 (src/db/schema/biometrics.ts).
--
-- O banco só GUARDA a criptografia dupla já pronta (packages/shared/src/crypto.ts
-- e o face-engine): o embedding vem cifrado pela engine com a DEK da empresa, e a
-- DEK fica em chaves_empresa cifrada com a MASTER_KEY (só no ambiente).
-- Como na 0002, toda função leva `SET search_path = rh, public`.

-- ============================================================================
-- Embedding só com consentimento ativo e com a DEK da empresa do colaborador
-- ============================================================================
CREATE OR REPLACE FUNCTION rh.fn_embedding_valido() RETURNS trigger
LANGUAGE plpgsql SET search_path = rh, public AS $$
DECLARE
    v_revogado_em  timestamptz;
    v_empresa_id   bigint;
BEGIN
    SELECT revogado_em INTO v_revogado_em
      FROM consentimentos_biometricos
     WHERE conta_id = NEW.conta_id AND id = NEW.consentimento_id;
    -- a FK composta já garante que o consentimento existe e é da mesma pessoa
    IF v_revogado_em IS NOT NULL THEN
        RAISE EXCEPTION 'Consentimento biométrico % revogado: o rosto não pode ser cadastrado', NEW.consentimento_id
            USING ERRCODE = 'check_violation';
    END IF;

    SELECT e.empresa_id INTO v_empresa_id
      FROM colaboradores c
      JOIN estabelecimentos e ON e.conta_id = c.conta_id AND e.id = c.estabelecimento_id
     WHERE c.conta_id = NEW.conta_id AND c.id = NEW.colaborador_id;
    IF v_empresa_id IS DISTINCT FROM NEW.empresa_id THEN
        RAISE EXCEPTION 'O embedding precisa da DEK da empresa do colaborador (empresa %), não da empresa %',
            v_empresa_id, NEW.empresa_id
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_embedding_valido
    BEFORE INSERT OR UPDATE ON rh.embeddings_faciais
    FOR EACH ROW EXECUTE FUNCTION rh.fn_embedding_valido();
--> statement-breakpoint

-- ============================================================================
-- Revogar o consentimento apaga o rosto (LGPD). O consentimento fica como prova.
-- Invalidar o cache da engine (DELETE /embeddings/{tenant}/{person}) é do serviço.
-- ============================================================================
CREATE OR REPLACE FUNCTION rh.fn_consentimento_revogado_apaga_embedding() RETURNS trigger
LANGUAGE plpgsql SET search_path = rh, public AS $$
BEGIN
    IF NEW.revogado_em IS NOT NULL AND OLD.revogado_em IS NULL THEN
        DELETE FROM embeddings_faciais
         WHERE conta_id = NEW.conta_id AND consentimento_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_consentimento_revogado_apaga_embedding
    AFTER UPDATE OF revogado_em ON rh.consentimentos_biometricos
    FOR EACH ROW EXECUTE FUNCTION rh.fn_consentimento_revogado_apaga_embedding();
--> statement-breakpoint

-- ============================================================================
-- Comentários
-- ============================================================================
COMMENT ON TABLE rh.chaves_empresa IS
    'DEK de cada empresa (AES-256), cifrada com a MASTER_KEY. Uma ativa por empresa; as antigas ficam para os embeddings que ainda apontam para elas. Nunca em log nem na API.';
--> statement-breakpoint
COMMENT ON TABLE rh.embeddings_faciais IS
    'Embedding facial cifrado pela engine com a DEK da empresa (contrato: embedding_iv, embedding_tag, embedding_ct). Biometria (LGPD): nunca em log nem na API.';
--> statement-breakpoint
COMMENT ON TABLE rh.consentimentos_biometricos IS
    'Consentimento biométrico do colaborador. Revogado continua guardado como prova; revogar apaga o embedding.';
--> statement-breakpoint

-- ============================================================================
-- Permissões do papel de runtime. As tabelas novas já nascem com DML para o
-- rh_api (ALTER DEFAULT PRIVILEGES da 0002); aqui só se tira o DELETE:
--   - chave apagada deixaria embeddings impossíveis de decifrar;
--   - consentimento é prova (LGPD), revoga-se, não se apaga.
-- Sem o papel (ex.: banco de teste), o bloco não faz nada.
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_api') THEN
        REVOKE DELETE, TRUNCATE ON rh.chaves_empresa FROM rh_api;
        REVOKE DELETE, TRUNCATE ON rh.consentimentos_biometricos FROM rh_api;
    END IF;
END;
$$;
