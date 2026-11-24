-- DESTRUTIVA. A senha sai de `usuarios`: o Better Auth guarda o hash em
-- `credenciais_login.senha_hash` (provedor `credential`), e manter as duas colunas
-- duplicaria a senha. Em 22/11/2026 não havia usuário real (só dados de teste).
-- Reversão: ALTER TABLE rh.usuarios ADD COLUMN senha_hash text;
--           UPDATE rh.usuarios u SET senha_hash = c.senha_hash
--             FROM rh.credenciais_login c WHERE c.usuario_id = u.id AND c.provedor = 'credential';
ALTER TABLE "rh"."usuarios" DROP COLUMN "senha_hash";
