#!/usr/bin/env bash
# Cria os papéis e o banco `app` (RH) na instância postgres-rh.
# Roda SOMENTE na primeira subida do volume (o entrypoint do Postgres ignora as demais).
#
# Permissões de tabela NÃO são dadas aqui: vêm da migration 0002 (apps/api/drizzle),
# que roda como rh_owner. Este script só cria papéis, o banco e ajusta o schema public.
set -euo pipefail

: "${RH_OWNER_PASSWORD:?RH_OWNER_PASSWORD não definida}"
: "${RH_API_PASSWORD:?RH_API_PASSWORD não definida}"

# Senhas entram como variáveis do psql (:'var' = literal com escape), nunca
# interpoladas pelo shell dentro do SQL.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$RH_OWNER_PASSWORD" -v api_pw="$RH_API_PASSWORD" <<-'SQL'
  -- Dono do banco app. Usado apenas pelas migrations (api-migrate).
  CREATE ROLE rh_owner LOGIN PASSWORD :'owner_pw';
  -- Papel de runtime da api do portal: DML no schema rh (dado pela migration), sem DDL.
  CREATE ROLE rh_api LOGIN PASSWORD :'api_pw';

  CREATE DATABASE app OWNER rh_owner;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname app <<-'SQL'
  REVOKE ALL ON DATABASE app FROM PUBLIC;
  GRANT CONNECT ON DATABASE app TO rh_owner, rh_api;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  ALTER SCHEMA public OWNER TO rh_owner;
SQL
