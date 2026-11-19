#!/usr/bin/env bash
# Cria os papéis e os bancos lógicos do Genus.
# Roda SOMENTE na primeira subida do volume pgdata (o entrypoint do Postgres ignora as demais).
#
# Permissões de tabela NÃO são dadas aqui: elas vêm das migrations em db/arp/migrations,
# que rodam como arp_owner. Este script só cria papéis, bancos e ajusta o schema public.
set -euo pipefail

: "${ARP_OWNER_PASSWORD:?ARP_OWNER_PASSWORD não definida}"
: "${ARP_COLLECTOR_PASSWORD:?ARP_COLLECTOR_PASSWORD não definida}"

# Senhas entram como variáveis do psql (:'var' = literal com escape), nunca
# interpoladas pelo shell dentro do SQL: uma aspa na senha não quebra nem injeta.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$ARP_OWNER_PASSWORD" -v collector_pw="$ARP_COLLECTOR_PASSWORD" <<-'SQL'
  -- Dono do banco arp (fiscal). Usado apenas pelas migrations.
  CREATE ROLE arp_owner LOGIN PASSWORD :'owner_pw';
  -- Papel de runtime da api do coletor: só INSERT e SELECT em entradas (dado pela migration).
  CREATE ROLE arp_collector LOGIN PASSWORD :'collector_pw';

  CREATE DATABASE arp OWNER arp_owner;
  -- Banco operacional: vazio por enquanto, dono padrão (superusuário do contêiner).
  CREATE DATABASE app;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname arp <<-SQL
  REVOKE ALL ON DATABASE arp FROM PUBLIC;
  GRANT CONNECT ON DATABASE arp TO arp_owner, arp_collector;

  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  ALTER SCHEMA public OWNER TO arp_owner;
  GRANT USAGE ON SCHEMA public TO arp_collector;
SQL
