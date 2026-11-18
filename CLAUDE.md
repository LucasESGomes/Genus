# Genus

SaaS de **RH com ponto eletrônico REP-P** (Portaria MTP 671/2021) e reconhecimento facial. Qualquer aparelho vira coletor, o registro continua sem internet, e o RH recebe apuração, escalas, atestados, banco de horas, fechamento e espelho. Autor: Otávio Vinícius Flauzino de Souza (Flauzino).

O motor facial vem da **Visage** (produto irmão, em `../visage`). A Visage **não se modifica**: aqui o motor é copiado e empacotado como serviço.

## Estado do projeto (18/11/2026)

- **Pronto, segundo o quadro de funcionalidades:** reconhecimento facial e coleta offline.
- **MVP do painel de RH: entrega em 25/11/2026** (módulos roxos). **Fase 2** = módulos azuis. Lista completa e plano de cada módulo: `docs/architecture/04-funcionalidades-rh.md`.
- **Neste repositório hoje:** `services/face-engine`, `bench/` e `docs/`. A API do portal, os portais web e o app do coletor **ainda não existem aqui**. A estrutura-alvo está abaixo.

## Mapa do repositório

```
services/face-engine/   Motor facial (Python). Cópia de REP-P/engine @ d80c5dd, que veio de visage/face_engine
bench/                  Benchmark de capacidade da engine (scripts; dados, chaves e resultados ficam fora do git)
docs/
  architecture/         01 contexto e Portaria · 02 arquitetura · 03 funcionalidades e modos · 04 funcionalidades de RH · diagramas
  conventions/          database.md · backend.md · security-lgpd.md
  face-engine.md        Contrato, configuração e lacunas do motor
  benchmark.md          Metodologia, números e o que eles decidem
apps/                   (a criar)  api/ (Fastify) · portal/ (Next.js) · mobile/ (Expo)
packages/               (a criar)  regras puras compartilhadas, ex.: cálculo de jornada
```

## Stack

| Camada | Tecnologia |
|---|---|
| API e workers | Node.js LTS + **TypeScript (strict) + Fastify 5**, validação com **Zod** |
| Banco | **PostgreSQL**, dois bancos lógicos: `arp` (fiscal, só cresce) e `app` (operacional) |
| Acesso ao banco | **Drizzle** no `app`; **SQL puro** no `rep-core` (a transação do NSR precisa de controle total) |
| Arquivos | **S3** (ou compatível): comprovantes, AFD/AEJ, atestados, fotos temporárias, backups |
| Fila | BullMQ sobre Valkey; **outbox no Postgres é a fonte da verdade**, a fila só transporta |
| Portais | Next.js + Tailwind + shadcn/ui; login com Better Auth |
| Coletor | React Native + Expo (Android primeiro) |
| Motor facial | Python 3.11 + FastAPI + InsightFace (SCRFD + ArcFace R50) + MiniFASNet (liveness) via ONNX Runtime |
| Assinatura PAdES/CAdES | Python + pyHanko (serviço `signer`, interno) |
| Logs / testes | Pino (JSON) · Vitest, Playwright, k6 |
| Infra | Docker Compose (Tiers 1 e 2); ver `docs/architecture/02-arquitetura.md` §9 |

## Arquitetura em dez linhas

1. O **aparelho** assina e guarda cada batida antes de enviar (primeiro outbox).
2. A **api-coletor** identifica o rosto no `face-engine` e grava na tabela `intake`; só o **rep-core** escreve no banco `arp`.
3. O **rep-core** atribui NSR e hash em uma transação com `FOR UPDATE` por estabelecimento e grava eventos no `outbox`.
4. **Jobs** consomem o outbox: PDF do comprovante, cálculo da jornada (PTRP), QR oficial, espelho, selo diário.
5. O **api-portal** (Fastify) serve os portais de RH, gestor e funcionário. As funcionalidades de RH são, em geral, **módulos novos nele + tabelas no banco `app`**.
6. O **PTRP** (apuração) só **acrescenta** informação sobre as marcações. Nunca altera a original.
7. O **face-engine** não tem banco: recebe embeddings cifrados na requisição, decifra em RAM e compara.
8. O **signer** assina comprovante, AFD e AEJ com o e-CNPJ ICP-Brasil.
9. Há uma **VM core** (APIs, workers, Postgres, Valkey) e uma **VM de reconhecimento** (face-engine) no Tier 1.
10. Detalhes: `docs/architecture/02-arquitetura.md`. Diagramas: `docs/architecture/tiers-rep-p.drawio`.

## Regras invioláveis

**Da Portaria 671 (arts. 74, 82 e 98):**
- O sistema **nunca bloqueia uma marcação**. Duplicidade, horário e cerca geográfica só **sinalizam**.
- **Nenhuma tela nem endpoint edita ou apaga uma marcação.** O RH acrescenta (justificativa, abono, pré-assinalação do intervalo) ou marca como indevida, em tabelas próprias do `app`.
- Sem marcação automática e sem exigir autorização prévia para hora extra.
- Só o `rep-core` escreve no `arp`. Os demais serviços leem com papel somente leitura. `registros`/`records` aceitam só INSERT (trigger recusa UPDATE e DELETE).

**Multi-tenant:**
- Toda tabela de negócio tem `tenant_id`, e **toda query filtra por ele**, sem exceção. Repositórios exigem `tenantId` como parâmetro; o tipo impede esquecer.
- O `tenant_id` vem da sessão, **nunca** do corpo da requisição.

**Dados sensíveis (LGPD):**
- Biometria e **dado de saúde** (atestado, CID, texto de OCR) são sensíveis: cifrados em coluna, acesso auditado, nunca em log.
- **CID só para o RH.** Gestor vê "afastado", sem diagnóstico.
- Nenhum segredo entra em `before_state`/`after_state` da auditoria. Veja `docs/conventions/security-lgpd.md`.

**Engine:** `workers=1` é obrigatório (cache em memória sem TTL). `BENCH_ENDPOINTS` **nunca** em produção. `InvalidTag` GCM jamais é silenciado.

## Convenções (resumo; versão completa em `docs/conventions/`)

**Idioma.** Identificadores (tabelas, colunas, código, rotas, chaves JSON, eventos, filas) em **inglês**. Siglas da Portaria e do domínio ficam como são: `cpf`, `cnpj`, `nsr`, `afd`, `aej`, `dsr`, `cid`, `crm`, `inpi`. Documentação, comentários que explicam regra legal e mensagens ao usuário em **pt-BR**. Mapa de termos: `docs/conventions/database.md` §12.

**Colunas do banco: uma regra por conceito.**

| Conceito | Padrão | Exemplo |
|---|---|---|
| Chave primária | `id BIGINT GENERATED ALWAYS AS IDENTITY` | |
| ID exposto fora (QR, link) | `public_id UUID NOT NULL DEFAULT gen_random_uuid()`, UNIQUE | |
| Tenant | `tenant_id BIGINT NOT NULL REFERENCES tenants(id)`, logo após `id` | |
| Chave estrangeira | `<tabela_no_singular>_id`; por papel: `manager_id`, `parent_id` | `employee_id` |
| Instante | `<verbo_no_passado>_at TIMESTAMPTZ` | `approved_at` |
| Dia (sem hora) | `<substantivo>_date DATE` | `work_date`, `admission_date` |
| Hora do dia | `<substantivo>_time TIME` (relógio local do estabelecimento) | `start_time` |
| Vigência | `start_date NOT NULL` + `end_date NULL` (NULL = em aberto, inclusivo) + exclusion constraint | |
| Duração | `<nome>_minutes INTEGER`. Nunca horas decimais | `worked_minutes` |
| Dinheiro | `<nome>_amount NUMERIC(12,2)` (BRL). Nunca FLOAT | `salary_amount` |
| Taxa | `<nome>_rate NUMERIC(6,4)` (0.5000 = 50%) | `overtime_rate` |
| Booleano | `is_*` / `has_*`, `NOT NULL DEFAULT` | `is_active` |
| Status | `status TEXT NOT NULL` + `CHECK`; valores `snake_case` em inglês | `pending` |
| Discriminador | `kind TEXT` + `CHECK`. Não usar `type` | `kind = 'add_punch'` |
| Ator da ação | `<verbo_no_passado>_by_id BIGINT REFERENCES users(id)` | `decided_by_id` |
| Motivo | `reason` (quem pede) · `decision_note` (quem decide) | |
| Arquivo no S3 | `<nome>_key` (chave do objeto, nunca URL) + `_sha256`, `_mime`, `_size_bytes` | `file_key` |
| Cifrado | `<nome>_enc BYTEA` | `cid_code_enc` |
| Hash / índice cego | `<nome>_hash BYTEA` | `cpf_hash` |
| JSON | `JSONB`, nomeado pelo conteúdo | `findings`, `params` |
| Escore | `<nome>_score` (`REAL` biometria; `SMALLINT` 0–100 para risco) | `risk_score` |
| CPF / CNPJ | `cpf CHAR(11)` / `cnpj CHAR(14)`, só dígitos. Empregador: `document_type` + `document` | |
| Auditoria da linha | `created_at`, `updated_at` (trigger), `created_by_id`. Tabelas só-INSERT não têm `updated_at` | |

**Nomes de objetos:** tabelas no plural `snake_case`; `pk_`, `fk_`, `uq_`, `ck_`, `ex_`, `idx_` como prefixo de constraints e índices. **Sem soft delete:** use `status`, `end_date` ou `is_active`. Registros de ledger (`*_entries`) só recebem INSERT; correção é um lançamento de estorno.

**API (Fastify):**
- Rotas sob `/portal` (nginx), `kebab-case`, plural. Ações como `POST /recurso/:id/approve`. `PATCH` para alteração parcial.
- JSON em `camelCase`. Sucesso `{ data }`; listas `{ data, meta: { page, pageSize, total } }`. Erro `{ error, code }` com `code` em `UPPER_SNAKE` e `error` em pt-BR.
- Camadas: **rota (fina) → service → repository**. Service é classe com dependências injetadas, sem singleton global. Cálculo de jornada em **funções puras**, testáveis por tabela.
- Todo schema Zod de resposta **remove** campos que não devem sair (cifrados, hashes).
- Hora: nunca `new Date()` direto; injete `Clock`. Dia de trabalho (`work_date`) é calculado no fuso do estabelecimento.
- Logs com Pino, JSON. Nunca `console.log`. Sem CPF completo, sem dado de saúde, sem embedding.

**Commits:** português, no estilo do histórico: `Área: o que mudou` (ex.: `Bench: limitar N ao teto de 1 MB`).

## Receita: adicionar uma funcionalidade (o caso mais comum)

1. **Migration** da tabela (`drizzle-kit generate`), seguindo `docs/conventions/database.md`. Nunca edite migration já aplicada.
2. **Schema Drizzle** em `apps/api/src/db/schema/`.
3. **Módulo** em `apps/api/src/modules/<nome>/`: `schemas.ts` (Zod), `repository.ts`, `service.ts`, `routes.ts`, `events.ts`, `rules/` (puro, se houver cálculo).
4. **Autorização** por papel e por escopo (gestor só vê a própria equipe).
5. **Auditoria:** registre o evento (`<domínio>.<verbo>`) com `before`/`after`.
6. **Evento/job** se o resultado muda a apuração: publique `recalculate-day` (ex-`calcular_jornada`) via outbox.
7. **Testes:** regra pura (Vitest, por tabela) + rota (integração com Postgres real).
8. **Docs:** atualize a seção do módulo em `docs/architecture/04-funcionalidades-rh.md`.

## Engine e benchmark (o que já foi medido)

Medido em 29/10/2026, **1 vCPU** (AMD EPYC 9354P, AES-NI, AVX2), compartilhada com outros serviços:

| Medida | Resultado |
|---|---|
| CPU por reconhecimento | **~42–44 ms**, dos quais detecção ~27 ms e liveness ~11 ms |
| Latência sequencial (p50, cliente) | 67 ms com 1 candidato · 101 ms com 240 |
| Teto teórico (CPU) | ~23 req/s · **medido ~17–19 req/s** com concorrência 4–16 |
| Criptografia (AES-GCM) | 5–13 µs por embedding. Não é gargalo |
| Limite por requisição | **~246 candidatos** (campo multipart de 1 MB, ~4,3 KB por candidato) |
| Rajada de 1000 de uma vez | sem controle de admissão: 989 timeouts (cliente de 10 s) ou 79 s para escoar |

Consequência: o gargalo é CPU de detecção e liveness, não o tamanho da empresa. Acima de ~240 funcionários por estabelecimento é preciso a galeria residente na engine (`/identify`), prevista em `02` §4.3. Detalhes e implicações: `docs/benchmark.md` e `docs/face-engine.md`.

## Comandos

```bash
# Motor facial (de dentro de services/face-engine). Exige MASTER_KEY (64 hex) e ENGINE_API_KEY no ambiente
python scripts/download_models.py
uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1
py -3 -m pytest                       # tier puro (padrão); -m integration contra engine viva; -m models com ONNX

# Benchmark (de dentro de bench/); passo a passo em bench/README.md
python bench.py init | set-url | check | capture | enroll | gen | micro | seq | conc | burst | report
```

## Como trabalhar neste repositório

- **[A CONFIRMAR]** marca interpretação ainda não validada (regra trabalhista, escolha técnica). **Não invente regra legal**: marque e pergunte.
- Não mexa em `../visage`. Não commite `.env`, `bench/.secrets.json`, `bench/data`, `bench/frames` nem `bench/results` (rostos e chaves).
- Mudança de arquitetura (novo componente, outro banco, outra fila) pede conversa antes. Funcionalidade nova dentro do padrão acima, não.
- Documentos `01`, `02` e `03` descrevem a arquitetura vigente e usam nomes em português nas tabelas do ARP. O mapa para os identificadores em inglês está em `docs/conventions/database.md` §12.
