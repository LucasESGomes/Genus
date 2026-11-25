-- Busca por texto sem acento nas listas (docs/totem-contrato.md §3.3): "jose" acha "José".
-- unaccent é extensão "trusted" desde o PostgreSQL 13: o papel das migrations cria, como btree_gist e citext.
CREATE EXTENSION IF NOT EXISTS unaccent;
