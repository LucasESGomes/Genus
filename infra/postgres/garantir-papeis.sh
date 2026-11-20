#!/usr/bin/env bash
# Garante os papéis do banco arp em um volume JÁ EXISTENTE.
#
# O init (init/01-bancos-e-papeis.sh) roda só na primeira subida do volume. Quando um papel
# novo entra no projeto (arp_core, arp_reader), este script o cria sem recriar o volume.
#
# - Cria cada papel SOMENTE se ele não existir. Senha de papel existente NÃO é alterada.
# - Garante GRANT CONNECT e USAGE no schema. NÃO altera dados, tabelas nem permissões de tabela
#   (essas vêm das migrations, como arp_owner).
# - Pode rodar quantas vezes for preciso (idempotente).
#
# Roda dentro do contêiner postgres, com as senhas das variáveis de ambiente que o compose passa
# ao serviço. Pelo host (dev-up faz isso):
#   docker compose -f infra/docker-compose.yml --env-file infra/.env exec -T postgres bash -s < infra/postgres/garantir-papeis.sh
# O script entra pela entrada padrão: nenhuma senha aparece na linha de comando do host.
set -euo pipefail

: "${POSTGRES_USER:?POSTGRES_USER não definida}"
: "${ARP_OWNER_PASSWORD:?ARP_OWNER_PASSWORD não definida}"
: "${ARP_COLLECTOR_PASSWORD:?ARP_COLLECTOR_PASSWORD não definida}"
: "${ARP_CORE_PASSWORD:?ARP_CORE_PASSWORD não definida}"
: "${ARP_READER_PASSWORD:?ARP_READER_PASSWORD não definida}"

# O banco arp é criado pelo init. Se não existe, este script não cria o ambiente inteiro:
# para com mensagem clara.
existe=$(psql -v ON_ERROR_STOP=1 -X -A -t --username "$POSTGRES_USER" --dbname postgres \
  -c "SELECT 1 FROM pg_database WHERE datname = 'arp'")
if [ "$existe" != "1" ]; then
  echo "garantir-papeis: o banco arp não existe neste volume. Rode a primeira subida (init) antes." >&2
  exit 1
fi

# Papéis são do cluster. Senhas entram como variáveis do psql (:'var'), nunca interpoladas pelo shell.
# \gexec executa só os CREATE ROLE gerados para papéis que ainda não existem.
psql -v ON_ERROR_STOP=1 -X --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$ARP_OWNER_PASSWORD" -v collector_pw="$ARP_COLLECTOR_PASSWORD" \
  -v core_pw="$ARP_CORE_PASSWORD" -v reader_pw="$ARP_READER_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'arp_owner', :'owner_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arp_owner') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'arp_collector', :'collector_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arp_collector') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'arp_core', :'core_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arp_core') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'arp_reader', :'reader_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arp_reader') \gexec
SQL

# Acesso ao banco arp. GRANT é idempotente; REVOKE de PUBLIC espelha o init.
psql -v ON_ERROR_STOP=1 -X --username "$POSTGRES_USER" --dbname postgres <<'SQL'
REVOKE ALL ON DATABASE arp FROM PUBLIC;
GRANT CONNECT ON DATABASE arp TO arp_owner, arp_collector, arp_core, arp_reader;
SQL

psql -v ON_ERROR_STOP=1 -X --username "$POSTGRES_USER" --dbname arp <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO arp_collector, arp_core, arp_reader;
SQL

echo "garantir-papeis: papéis e acessos do banco arp conferidos."
