-- Painel do super_admin: regras que o Drizzle não declara (docs/prompts/super-admin-contrato.md).
-- Reverter: DROP TRIGGER trg_conta_inativa_sessoes, trg_conta_atualizado, trg_tentativa_login_imutavel e
-- trg_tentativa_login_sem_truncate; DROP FUNCTION das três funções; DROP CONSTRAINT conta_suspensa_por_id_fkey.

-- A FK fica aqui e não no Drizzle: contas e usuarios se referenciam e o schema TypeScript viraria um ciclo de tipos.
ALTER TABLE rh.contas ADD CONSTRAINT conta_suspensa_por_id_fkey
    FOREIGN KEY (suspensa_por_id) REFERENCES rh.usuarios (id);
--> statement-breakpoint

-- atualizado_em da conta
CREATE OR REPLACE FUNCTION rh.fn_conta_atualizado() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    NEW.atualizado_em := now();
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_conta_atualizado
    BEFORE UPDATE ON rh.contas
    FOR EACH ROW EXECUTE FUNCTION rh.fn_conta_atualizado();
--> statement-breakpoint

-- Conta suspensa perde todas as sessões na hora (o login novo é recusado pela api).
CREATE OR REPLACE FUNCTION rh.fn_conta_inativa_encerra_sessoes() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    IF OLD.ativo AND NOT NEW.ativo THEN
        DELETE FROM rh.sessoes WHERE conta_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_conta_inativa_sessoes
    AFTER UPDATE OF ativo ON rh.contas
    FOR EACH ROW EXECUTE FUNCTION rh.fn_conta_inativa_encerra_sessoes();
--> statement-breakpoint

-- tentativas_login só aceita INSERT (trilha de segurança, como a auditoria).
CREATE OR REPLACE FUNCTION rh.fn_tentativa_login_imutavel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = rh, public
AS $$
BEGIN
    RAISE EXCEPTION 'Tentativa de login não pode ser alterada nem removida'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER trg_tentativa_login_imutavel
    BEFORE UPDATE OR DELETE ON rh.tentativas_login
    FOR EACH ROW EXECUTE FUNCTION rh.fn_tentativa_login_imutavel();
--> statement-breakpoint

-- TRUNCATE não dispara trigger de linha.
CREATE TRIGGER trg_tentativa_login_sem_truncate
    BEFORE TRUNCATE ON rh.tentativas_login
    FOR EACH STATEMENT EXECUTE FUNCTION rh.fn_tentativa_login_imutavel();
--> statement-breakpoint

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rh_api') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON rh.tentativas_login FROM rh_api;
    END IF;
END
$$;
--> statement-breakpoint

COMMENT ON COLUMN rh.contas.motivo_suspensao IS
  'Por que a conta foi suspensa (texto do super_admin). Obrigatório com ativo = false (ck conta_suspensao_coerente).';
--> statement-breakpoint

COMMENT ON COLUMN rh.contas.suspensa_por_id IS
  'Super_admin que suspendeu a conta. NULL com a conta ativa.';
--> statement-breakpoint

COMMENT ON TABLE rh.tentativas_login IS
  'Uma linha por tentativa de login (senha ou TOTP), só INSERT. email_hash é HMAC-SHA256: o e-mail em claro nunca é gravado. '
  'Só sinaliza abuso; nada é bloqueado por esta tabela. Retenção de 90 dias [A CONFIRMAR].';
--> statement-breakpoint

COMMENT ON COLUMN rh.tentativas_login.email_hash IS
  'HMAC-SHA256 do e-mail com chave derivada do BETTER_AUTH_SECRET. Nunca sai na API.';
