-- Extensões usadas pelo schema rh (schema-rh.sql). Ficam no schema public.
-- Ambas são "trusted" (PostgreSQL 13+): o dono do banco (rh_owner) pode criá-las.
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- EXCLUDE com coluna escalar + intervalo
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;       -- e-mail sem diferenciar maiúsculas
