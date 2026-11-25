#!/usr/bin/env bash
# Garante papéis, bancos e acessos do Postgres do Genus. IDEMPOTENTE: roda a cada `docker compose up`
# (serviço `db-roles`) e também em volume antigo, sem recriar nada que já existe.
#
# Uma instância, dois bancos lógicos (docs/architecture/02-arquitetura.md §4.5):
#   arp  fiscal, só cresce.   Papéis: arp_owner (migrations), arp_collector, arp_core, arp_reader
#   app  operacional (RH).    Papéis: rh_owner (migrations), rh_api (runtime da api do portal),
#                             genus_coletor_leitura (api do coletor: SOMENTE LEITURA, ver abaixo)
#
# - Cria cada papel e cada banco SOMENTE se não existir. Senha de papel existente NÃO é alterada.
# - Dá CONNECT e USAGE no schema. NÃO dá permissão de tabela: ela vem das migrations (db/arp/migrations
#   e apps/api/drizzle), que rodam como o dono do banco. ÚNICA exceção: `genus_coletor_leitura` (docs/totem-contrato.md §2),
#   que recebe aqui o SELECT, só nas colunas de que a api do coletor precisa e só nas tabelas que já existem. Assim a ordem
#   (migration do RH antes ou depois deste script) não importa: a migration também pode conceder, e o script repete a cada subida.
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
: "${COLETOR_LEITURA_PASSWORD:?COLETOR_LEITURA_PASSWORD não definida}"

# Papéis são do cluster. \gexec executa só os CREATE ROLE / CREATE DATABASE gerados para o que ainda não existe.
psql -v ON_ERROR_STOP=1 -X --dbname postgres \
  -v arp_owner_pw="$ARP_OWNER_PASSWORD" -v arp_collector_pw="$ARP_COLLECTOR_PASSWORD" \
  -v arp_core_pw="$ARP_CORE_PASSWORD" -v arp_reader_pw="$ARP_READER_PASSWORD" \
  -v rh_owner_pw="$RH_OWNER_PASSWORD" -v rh_api_pw="$RH_API_PASSWORD" \
  -v coletor_leitura_pw="$COLETOR_LEITURA_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', r.nome, r.senha)
FROM (VALUES
  ('arp_owner', :'arp_owner_pw'),
  ('arp_collector', :'arp_collector_pw'),
  ('arp_core', :'arp_core_pw'),
  ('arp_reader', :'arp_reader_pw'),
  ('rh_owner', :'rh_owner_pw'),
  ('rh_api', :'rh_api_pw'),
  ('genus_coletor_leitura', :'coletor_leitura_pw')
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
GRANT CONNECT ON DATABASE app TO rh_owner, rh_api, genus_coletor_leitura;

-- Papel de leitura da api do coletor: nenhuma transação dele escreve, nem por engano.
ALTER ROLE genus_coletor_leitura SET default_transaction_read_only = on;
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

-- genus_coletor_leitura: SELECT por coluna (menor privilégio: nada de pin_hash, nome de setor etc.).
-- Só entra o que existe agora; o que ainda não existe é concedido na próxima subida (ou pela migration do RH).
DO $$
DECLARE
  alvo record;
  colunas text;
BEGIN
  IF to_regnamespace('rh') IS NULL THEN
    RETURN;
  END IF;
  GRANT USAGE ON SCHEMA rh TO genus_coletor_leitura;
  FOR alvo IN SELECT * FROM (VALUES
    ('aparelhos', ARRAY['id', 'conta_id', 'estabelecimento_id', 'ativo', 'chave_hash',
                        'limiar_reconhecimento', 'limiar_vivacidade']),
    ('colaboradores', ARRAY['id', 'conta_id', 'estabelecimento_id', 'cpf', 'nome', 'data_desligamento']),
    ('embeddings_faciais', ARRAY['conta_id', 'colaborador_id', 'empresa_id', 'versao_chave',
                                 'embedding_iv', 'embedding_tag', 'embedding_ct']),
    ('chaves_empresa', ARRAY['conta_id', 'empresa_id', 'versao_chave', 'versao_kek',
                             'dek_iv', 'dek_tag', 'dek_ct', 'eh_ativa'])
  ) AS t(tabela, cols)
  LOOP
    SELECT string_agg(format('%I', column_name), ', ') INTO colunas
      FROM information_schema.columns
     WHERE table_schema = 'rh' AND table_name = alvo.tabela AND column_name = ANY (alvo.cols);
    IF colunas IS NOT NULL THEN
      EXECUTE format('GRANT SELECT (%s) ON rh.%I TO genus_coletor_leitura', colunas, alvo.tabela);
    END IF;
  END LOOP;
END
$$;
SQL

echo "bootstrap: papéis, bancos (arp, app) e acessos conferidos."
