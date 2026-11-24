-- Regras da autenticação (Better Auth) que o Drizzle não expressa.

-- 1. conta_id das tabelas de login vem SEMPRE do usuário. O Better Auth não sabe de
--    conta; o trigger sobrescreve qualquer valor enviado, para que a sessão nunca
--    aponte para outra conta. sessoes.conta_id é a origem do tenantId do req.ctx.
CREATE OR REPLACE FUNCTION rh.fn_login_conta_do_usuario() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    SELECT u.conta_id INTO NEW.conta_id FROM rh.usuarios u WHERE u.id = NEW.usuario_id;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_sessao_conta BEFORE INSERT OR UPDATE OF usuario_id, conta_id ON rh.sessoes
    FOR EACH ROW EXECUTE FUNCTION rh.fn_login_conta_do_usuario();
--> statement-breakpoint
CREATE TRIGGER trg_credencial_conta BEFORE INSERT OR UPDATE OF usuario_id, conta_id ON rh.credenciais_login
    FOR EACH ROW EXECUTE FUNCTION rh.fn_login_conta_do_usuario();
--> statement-breakpoint
CREATE TRIGGER trg_dois_fatores_conta BEFORE INSERT OR UPDATE OF usuario_id, conta_id ON rh.dois_fatores
    FOR EACH ROW EXECUTE FUNCTION rh.fn_login_conta_do_usuario();
--> statement-breakpoint

-- 2. Usuário desativado perde todas as sessões na hora (o login novo já é recusado
--    pela api; isto derruba as sessões abertas).
CREATE OR REPLACE FUNCTION rh.fn_usuario_inativo_encerra_sessoes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.ativo AND NOT NEW.ativo THEN
        DELETE FROM rh.sessoes WHERE usuario_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_usuario_inativo_sessoes AFTER UPDATE OF ativo ON rh.usuarios
    FOR EACH ROW EXECUTE FUNCTION rh.fn_usuario_inativo_encerra_sessoes();
--> statement-breakpoint

COMMENT ON TABLE rh.sessoes IS 'session do Better Auth. token nunca sai em log.';
--> statement-breakpoint
COMMENT ON TABLE rh.credenciais_login IS 'account do Better Auth. senha_hash (scrypt) nunca sai na API nem em log.';
--> statement-breakpoint
COMMENT ON TABLE rh.verificacoes IS 'verification do Better Auth. Da plataforma: sem conta_id.';
--> statement-breakpoint
COMMENT ON TABLE rh.chaves_jwt IS 'jwks do plugin JWT. Da plataforma: sem conta_id. chave_privada cifrada pelo Better Auth.';
--> statement-breakpoint
COMMENT ON TABLE rh.dois_fatores IS 'twoFactor (TOTP) do Better Auth. segredo e codigos_backup cifrados pelo Better Auth.';
