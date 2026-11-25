-- Convites de usuário: regras que o Drizzle não declara.
-- Reverter: DROP TRIGGER trg_convite_usuario_regras ON rh.convites_usuario; DROP FUNCTION rh.fn_convite_usuario_regras().

-- O que o convite concede (conta, e-mail, papel) e quem pode usá-lo (hashes, prazo) não muda depois de criado.
-- Convite aceito ou revogado é final.
CREATE OR REPLACE FUNCTION rh.fn_convite_usuario_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    IF OLD.status <> 'pendente' THEN
        RAISE EXCEPTION 'Convite encerrado não pode ser alterado'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF ROW(NEW.conta_id, NEW.email, NEW.nome, NEW.papel, NEW.cpf_hash, NEW.token_hash, NEW.expira_em, NEW.criado_por_id, NEW.criado_em)
       IS DISTINCT FROM
       ROW(OLD.conta_id, OLD.email, OLD.nome, OLD.papel, OLD.cpf_hash, OLD.token_hash, OLD.expira_em, OLD.criado_por_id, OLD.criado_em)
       OR NEW.tentativas < OLD.tentativas THEN
        RAISE EXCEPTION 'Os dados do convite não podem ser alterados'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_convite_usuario_regras
    BEFORE UPDATE ON rh.convites_usuario
    FOR EACH ROW EXECUTE FUNCTION rh.fn_convite_usuario_regras();
--> statement-breakpoint

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_api') THEN
        REVOKE DELETE, TRUNCATE ON rh.convites_usuario FROM rh_api;
    END IF;
END
$$;
--> statement-breakpoint

COMMENT ON TABLE rh.convites_usuario IS
  'Convite de uso único para criar usuário admin ou rh da própria conta. Token e CPF nunca são gravados em claro.';
--> statement-breakpoint

COMMENT ON COLUMN rh.convites_usuario.cpf_hash IS
  'HMAC-SHA256 do CPF com chave derivada do BETTER_AUTH_SECRET. Nunca sai na API.';
--> statement-breakpoint

COMMENT ON COLUMN rh.convites_usuario.token_hash IS
  'SHA-256 do token do link. Nunca sai na API.';
