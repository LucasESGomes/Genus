#!/usr/bin/env bash
# Garante papéis, bancos e acessos do Postgres do Genus. IDEMPOTENTE: roda a cada `docker compose up`
# (serviço `db-roles`) e também em volume antigo, sem recriar nada que já existe.
#
# Uma instância, dois bancos lógicos (docs/architecture/02-arquitetura.md §4.5):
#   arp  fiscal, só cresce.   Papéis: arp_owner (migrations), arp_collector, arp_core, arp_reader
#   app  operacional (RH).    Papéis: rh_owner (migrations), rh_api (runtime da api do portal)
#
# - Cria cada papel e cada banco SOMENTE se não existir. Senha de papel existente NÃO é alterada.
# - Dá CONNECT e USAGE no schema. NÃO dá permissão de tabela: ela vem das migrations (db/arp/migrations
#   e apps/api/drizzle), que rodam como o dono do banco.
# - Senhas entram como variáveis do psql (:'var'), nunca interpoladas pelo shell dentro do SQL.
#
# A conexão usa as variáveis padrão do libpq (PGHOST, PGUSER, PGPASSWORD).
set -euo pipefail

: "${PGUSER:?PGUSER não definida}"
: "${ARP_OWNER_PASSWORD:?ARP_OWNER_PASSWORD não definida}"
: "${ARP_COLLECTOR_PASSWORD:?ARP_COLLECTOR_PASSWORD não definida}"
: "${ARP_CORE_PASSWORD:?ARP_CORE_PASSWORD não definida}"
: "${ARP_READER_PASSWORD:?ARP_READER_PASSWORD não definida}"
: "${RH_OWNER_PASSWORD:?RH_OWNER_PASSWORD não definida}"
: "${RH_API_PASSWORD:?RH_API_PASSWORD não definida}"

# Papéis são do cluster. \gexec executa só os CREATE ROLE / CREATE DATABASE gerados para o que ainda não existe.
psql -v ON_ERROR_STOP=1 -X --dbname postgres \
  -v arp_owner_pw="$ARP_OWNER_PASSWORD" -v arp_collector_pw="$ARP_COLLECTOR_PASSWORD" \
  -v arp_core_pw="$ARP_CORE_PASSWORD" -v arp_reader_pw="$ARP_READER_PASSWORD" \
  -v rh_owner_pw="$RH_OWNER_PASSWORD" -v rh_api_pw="$RH_API_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', r.nome, r.senha)
FROM (VALUES
  ('arp_owner', :'arp_owner_pw'),
  ('arp_collector', :'arp_collector_pw'),
  ('arp_core', :'arp_core_pw'),
  ('arp_reader', :'arp_reader_pw'),
  ('rh_owner', :'rh_owner_pw'),
  ('rh_api', :'rh_api_pw')
) AS r(nome, senha)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r.nome) \gexec

SELECT 'CREATE DATABASE arp OWNER arp_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'arp') \gexec
SELECT 'CREATE DATABASE app OWNER rh_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'app') \gexec

-- Volume antigo: o banco app já existia, vazio, com o superusuário como dono.
ALTER DATABASE arp OWNER TO arp_owner;
ALTER DATABASE app OWNER TO rh_owner;

REVOKE ALL ON DATABASE arp FROM PUBLIC;
GRANT CONNECT ON DATABASE arp TO arp_owner, arp_collector, arp_core, arp_reader;
REVOKE ALL ON DATABASE app FROM PUBLIC;
GRANT CONNECT ON DATABASE app TO rh_owner, rh_api;
SQL

psql -v ON_ERROR_STOP=1 -X --dbname arp <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO arp_owner;
GRANT USAGE ON SCHEMA public TO arp_collector, arp_core, arp_reader;
SQL

psql -v ON_ERROR_STOP=1 -X --dbname app <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO rh_owner;
GRANT USAGE ON SCHEMA public TO rh_api;
SQL

echo "bootstrap: papéis, bancos (arp, app) e acessos conferidos."
