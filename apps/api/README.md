# apps/api · API do portal de RH

Fastify 5 + Zod + Drizzle sobre o banco **`app`** (schema **`rh`**), na MESMA instância Postgres do `arp` (ponto/fiscal): um container, dois bancos lógicos, separados por banco e por papel. Funciona em PostgreSQL **15 ou mais novo** (`UNIQUE NULLS NOT DISTINCT`); o compose usa o 17.6.

## Cadastro único: o RH é a origem dos IDs

O `arp` (parte do ponto) não tem cadastro. Cada batida guarda só `conta_id`, `estabelecimento_id`, `aparelho_id`, `colaborador_id` e `cpf`, sem FK (outro banco). Esses IDs **vêm daqui** (`rh.contas`, `rh.estabelecimentos`, `rh.aparelhos`, `rh.colaboradores`): o ponto referencia o cadastro do RH, nunca cria o seu.

- `pnpm rh:check-arp` confere isso nos bancos reais (só leitura; no arp com o papel `arp_reader`) e lista, com CPF mascarado: conta/estabelecimento/aparelho/colaborador que o RH não tem, aparelho de outro estabelecimento, CPF diferente do cadastrado e CPF sem colaborador na conta. Sai com código 1 se houver divergência.
- CPF e CNPJ são únicos **por conta**, como no índice `(conta_id, cpf)` do arp.

## Subir

```bash
pnpm install
pnpm setup:dev           # só na primeira vez: .env da raiz (senhas geradas) e os .env.dev dos apps
cd apps/api && docker compose up -d     # a api do RH e o que ela precisa: Postgres, papéis, migrations
docker compose up -d     # (da raiz) o projeto inteiro: ponto + RH
docker compose watch     # opcional: recarrega a api ao salvar
```

`cd apps/api && docker compose up` liga, nesta ordem: `postgres` (saudável) → `db-roles` (papéis `rh_owner` e `rh_api`, bancos `arp` e `app`) → `arp-migrate` → `rh-migrate` (Drizzle, como `rh_owner`) → `api` (como `rh_api`). O Postgres é **o mesmo** do ponto (`genus-postgres-arp-app`, porta 5432): uma instância, dois bancos. As definições ficam em `service.compose.yml`; o `docker-compose.yml` da pasta é só a entrada.

API em `http://localhost:3002` (`/health`, `/health/ready`).

Fora do Docker (com a infra no ar, `pnpm dev:up`): `pnpm db:migrate:rh` e `pnpm dev:api` (ou `pnpm dev`, que sobe também o ponto). O Swagger (`/docs`) só abre assim, porque só atende 127.0.0.1. Não rode a api no host e no Docker ao mesmo tempo: a porta 3002 é a mesma.

## Estrutura

```
apps/api/
  schema-rh.sql            desenho original do schema (referência; a verdade são as migrations)
  drizzle/                 migrations (0000 extensões · 0001 tabelas, gerada · 0002 regras, à mão) + meta/
  drizzle.config.ts        drizzle-kit
  service.compose.yml      rh-migrate e api (Docker); docker-compose.yml é a entrada, que inclui o db/
  src/
    server.ts · app.ts · container.ts
    config/env.ts          variáveis validadas com Zod
    db/client.ts           Pool + Drizzle
    db/migrate.ts          runner das migrations (usado pelo api-migrate)
    db/schema/             tabelas: coluna em português, propriedade em inglês (database.md §12)
    arp/                   conferência arp x RH (consistency.ts é puro; check-arp.ts lê os bancos)
    http/contracts.ts      envelopes { data } / { error, code }
    plugins/               erros (inclui SQLSTATE do Postgres → 409/422), Swagger
    modules/<nome>/        schemas.ts · repository.ts · service.ts · routes.ts · rules/ (CLAUDE.md, "Receita")
  scripts/check-arp.ts     CLI do pnpm rh:check-arp
  test/                    Vitest; sobe Postgres real (Testcontainers). RH_TEST_PG_IMAGE=postgres:15.14-alpine testa no 15
```

## Migrations

- Mudou a tabela: edite `src/db/schema/*.ts` e rode `pnpm db:generate:rh -- --name <descricao_em_portugues>`.
- Regra que o Drizzle não declara (EXCLUDE, trigger, view, GRANT): `pnpm --filter @genus/api exec drizzle-kit generate --custom --name <descricao>` e escreva o SQL.
- Nunca edite migration já aplicada. Aplicar: `pnpm db:migrate:rh` ou `docker compose up --build api-migrate`.

## Diferenças em relação ao `schema-rh.sql`

1. `atestado.cid` → `cid_cifrado bytea` e `atestado_analise.ocr_texto` → `ocr_texto_cifrado bytea`: dado de saúde é cifrado em coluna (regra inviolável de LGPD do CLAUDE.md).
2. Funções com `SET search_path = rh, public`: o `SET search_path` do arquivo só valia para a sessão que o rodava.
3. `fn_bloqueia_periodo_fechado` confere também a linha antiga (OLD): um UPDATE que tirasse a linha de um período fechado passava.
4. `fn_ferias_inicio_valido` só considera feriado estadual/municipal do estabelecimento do colaborador.
5. `auditoria` recusa também `TRUNCATE`.
6. Permissões: `rh_api` lê e escreve no schema `rh`, mas na `auditoria` só `INSERT` e `SELECT`.
7. Multi-tenant (CLAUDE.md): tabela `conta` e `conta_id` em todas as tabelas. FKs entre tabelas da conta são compostas, `(conta_id, x_id) → pai (conta_id, id)`: o banco recusa ligar dados de contas diferentes. Exceções: `feriado` e `parametro_legal` aceitam `conta_id` NULL (catálogo global); `usuario` só fica sem conta se for `super_admin`; `auditoria` aceita NULL para ação da plataforma. Colunas de autor (`criado_por`, `decidido_por`, `usuario_id` da auditoria) têm FK simples para o super_admin poder agir numa conta.
8. CPF e CNPJ únicos por conta (`UNIQUE (conta_id, cpf)`), não no sistema inteiro.
9. Tabela nova `aparelho` (o arp grava `aparelho_id`). A autenticação do aparelho é da parte do ponto e entra depois.
