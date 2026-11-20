# Desenvolvimento local

> Como subir o Genus na sua máquina: banco, motor facial e a api do coletor. Os comandos são da raiz do repositório, salvo quando o texto disser outra pasta.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | **24 LTS**, conforme `.nvmrc` (`24.14.1`) | Com `nvm`: `nvm use` |
| pnpm | **10** | `package.json` fixa a versão em `packageManager` (pnpm 10.20.0). Use `corepack enable` |
| Docker | Recente, com Compose v2 | Obrigatório para o banco, a engine e os testes (Testcontainers) |
| Postman CLI | Recente (comando `postman`) | Só para `pnpm postman:test`. [Instalação](https://learning.postman.com/docs/postman-cli/postman-cli-installation/) |

## 2. Começo rápido (do zero a uma batida reconhecida)

```bash
pnpm install
pnpm dev:up        # cria os .env com segredos, sobe Postgres + engine e aplica a migration
pnpm dev           # sobe a api em http://localhost:3001 (deixe este terminal aberto)
```

Em outro terminal:

```bash
# suas fotos: uma pasta por pessoa (dev-data/ nunca vai ao Git)
#   dev-data/faces/<seu-nome>/1.jpg, 2.jpg, ...
pnpm dev:enroll-fake   # embedding de 3 fotos sorteadas + 50 candidatos fictícios
# reinicie o pnpm dev (Ctrl+C e de novo) para a api carregar a galeria
pnpm dev:punch         # uma batida com uma foto que a engine nunca viu
```

Esperado no `dev:punch`: `HTTP 200`, `"outcome": "registered"` e um `receiptId`. Repita e a segunda vem com o aviso `possible_duplicate` (mesma pessoa em menos de 60 s), ainda registrada. A batida fica em `arp.entradas` como `pendente`.

| Comando | O que faz |
|---|---|
| `pnpm setup:dev` | Cria `infra/.env` e `apps/collector-api/.env.dev` com segredos gerados e coerentes entre si (mesma `MASTER_KEY` e `ENGINE_API_KEY`, senhas dos papéis nas URLs). Se já existem, só completa o que falta. Não imprime nenhum valor |
| `pnpm dev:up` | `setup:dev` + `docker compose ... --profile dev up -d --wait` + `pnpm db:migrate:arp`. A primeira vez baixa os modelos da engine (alguns minutos) |
| `pnpm dev` | Api do coletor com `apps/collector-api/.env.dev`, recarrega ao salvar |
| `pnpm dev:enroll-fake` | Galeria `dev-data/gallery.json`: cada subpasta de `dev-data/faces/` é uma pessoa; sorteia `--photos` fotos (padrão 3) para a engine gerar o embedding cifrado; cria `--fakes` candidatos fictícios (padrão 50). As fotos não sorteadas vão para `dev-data/probes/<pessoa>/` (para testar) e uma delas para `dev-data/probes/proxima-batida.jpg` (usada pelo Postman) |
| `pnpm dev:punch` | Uma batida contra a api rodando. Opções: `--image <arquivo>`, `--sequence N` (repetir a mesma = teste de idempotência), `--captured-at <ISO>` |

Exemplos:

```bash
pnpm dev:enroll-fake -- --photos 5 --fakes 100
pnpm dev:punch -- --image dev-data/probes/otavio/5.jpg
pnpm dev:punch -- --sequence 42     # rode duas vezes: mesmo receiptId, sem linha nova
```

**Por que a DEK de dev é fixa:** a engine guarda a DEK de cada conta em cache por 1 h e, enquanto isso, ignora a DEK enviada. Por isso a DEK de dev é derivada da `MASTER_KEY` (sempre a mesma), e o `dev:enroll-fake` invalida o cache de embeddings da engine para cada pessoa gravada. Em produção cada conta tem DEK aleatória em `chaves_conta`.

### 2.1 Configuração manual (se não quiser o `setup:dev`)

Copie `infra/.env.example` → `infra/.env` e `apps/collector-api/.env.dev.example` → `apps/collector-api/.env.dev`, e troque todo `TROQUE_` (a api recusa subir com placeholder):

- `MASTER_KEY`: 64 hex (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`), **igual** nos dois arquivos.
- `ENGINE_API_KEY`: igual nos dois arquivos.
- `COLLECTOR_SERVICE_KEYS`: uma ou mais chaves (≥ 32 caracteres), separadas por vírgula.
- `ARP_OWNER_PASSWORD` e `ARP_COLLECTOR_PASSWORD` entram nas URLs `ARP_MIGRATION_DATABASE_URL` e `ARP_DATABASE_URL`, com a porta `POSTGRES_PORT`.

## 3. Subir o banco e a engine

```bash
# Só o Postgres (a api sobe, mas sem a engine responde `fallback_required`)
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d postgres

# Com a engine exposta em 127.0.0.1:8001 (necessário para o fluxo de reconhecimento)
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile dev up -d
```

Containers e volumes (`docker ps`, `docker volume ls`):

| Container | O que é |
|---|---|
| `genus-postgres-arp-app` | Um único Postgres com os **dois** bancos: `arp` (fiscal, REP-P: batidas) e `app` (operacional, portais de RH). Eles se separam por banco e por papel, não por container. Dados no volume `genus-postgres-arp-app-dados` |
| `genus-face-engine` | Motor facial. Só na rede interna do Compose. Modelos no volume `genus-face-engine-modelos` |
| `genus-face-engine-porta-dev` | Só no perfil `dev`: publica a engine em `127.0.0.1:8001` |

Para abrir um dos bancos: `docker exec -it genus-postgres-arp-app psql -U <POSTGRES_USER> -d arp` (ou `-d app`).

Pontos de atenção:

- O script `infra/postgres/init` cria os papéis `arp_owner` e `arp_collector` e os bancos `arp` e `app`. Ele roda **só na primeira subida** do volume `genus-postgres-arp-app-dados`. Se trocar uma senha depois, o volume precisa ser recriado (`docker compose ... down -v`). Isso apaga os dados locais. Sintoma de senha trocada sem recriar o volume: a migration falha com "senha recusada (28P01)".
- A primeira subida da engine baixa os modelos ONNX. Pode levar alguns minutos. O healthcheck tem tolerância de 300 s.
- Verifique a engine com `curl http://127.0.0.1:8001/health`. O esperado é `"status": "ok"`. Veja também `docs/face-engine.md` §3.

## 4. Aplicar a migration do banco arp

```bash
pnpm install
pnpm db:migrate:arp                      # dev: lê apps/collector-api/.env.dev
pnpm db:migrate:arp -- --env homolog     # lê apps/collector-api/.env.homolog
pnpm db:migrate:arp -- --env prod        # lê apps/collector-api/.env.prod
pnpm db:migrate:arp -- --env-file <arq>  # arquivo explícito
```

O comando lê `ARP_MIGRATION_DATABASE_URL` do arquivo do ambiente escolhido (padrão: `APP_ENV` do shell ou `dev`). Se a variável estiver exportada no shell, ela vence o arquivo. A URL usa o papel `arp_owner` e a porta `POSTGRES_PORT` do `infra/.env`. Nunca use `arp_collector` para migrar. O comando mostra de qual arquivo leu a URL, sem imprimir o valor.

A migration aplicada não muda mais. Nova alteração de banco vira uma nova migration.

## 5. Rodar a api do coletor

```bash
pnpm dev
```

O script `dev` lê `apps/collector-api/.env.dev` e recarrega ao salvar. A api sobe na porta `PORT` (3001).

| Endereço | O que é |
|---|---|
| `http://localhost:3001/health` | Estado da api, do banco e da engine (sem chave) |
| `http://localhost:3001/docs` | **Swagger** (OpenAPI 3) com todas as rotas, o corpo multipart da batida, os erros e a chave `X-Service-Key` (botão Authorize) |
| `http://localhost:3001/docs/json` | O documento OpenAPI em JSON |

O Swagger **não é público**: só existe com `APP_ENV=dev` (em homolog e prod as rotas nem são montadas) e, mesmo em dev, só responde a chamadas da própria máquina (127.0.0.1/::1). De outra máquina, 404.

Se a engine estiver fora, a api continua no ar e responde `fallback_required` para as batidas. Isso é esperado.

## 6. Testes e verificações

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

`pnpm -r test` exige o Docker em execução. Os testes de banco sobem um Postgres temporário com Testcontainers. Ele não usa o `infra/`.

## 7. Postman

A coleção está em YAML (Postman Collection v3) em `postman/collections/Genus Coletor/`, com os environments em `postman/environments/*.environment.yaml`. Guia completo: [`conventions/api-testing.md`](conventions/api-testing.md).

```bash
pnpm postman:test                    # Postman CLI: sobe o stub da engine e a api, roda as pastas automáticas
pnpm postman:test -- --real-engine   # com a engine real (pnpm dev:up antes)
```

Para importar no Postman: `pnpm postman:export` e arraste os dois arquivos de `postman/export/` no Import. Ou, no modo Git: abra a **pasta do repositório** (o `.postman/resources.yaml` registra a coleção e os environments), ponha a Working directory na raiz do repositório, escolha o environment `dev` e preencha `serviceKey` com a primeira chave de `COLLECTOR_SERVICE_KEYS` do `.env.dev`. A pasta **Rosto real** faz uma batida com a sua foto.

## 8. Benchmark

```bash
pnpm bench:punch -- --n 50 --concurrency 4                                       # imagem sintética
pnpm bench:punch -- --n 50 --concurrency 4 --image dev-data/probes/<pessoa>/<foto>.jpg   # rosto real
```

- Sem `--image`, a imagem é sintética: mede só decodificação e **detecção** (a engine para em `no_face`).
- Com uma foto de `dev-data/probes/` (depois do `dev:enroll-fake`), mede o pipeline completo: detecção, liveness, embedding e comparação com os candidatos.
- **`dev-data/` nunca vai ao Git.** Tem rostos e embeddings. Não copie essas fotos para outras pastas do repositório.

## 9. Trocar de ambiente

| Ambiente | `APP_ENV` | Arquivo de exemplo | Arquivo real |
|---|---|---|---|
| Desenvolvimento | `dev` | `.env.dev.example` | `.env.dev` |
| Homologação | `homolog` | [A CONFIRMAR] sem exemplo nesta entrega | `.env.homolog` |
| Produção | `prod` | `.env.prod.example` | `.env.prod` |

- `APP_ENV` deve bater com o nome do arquivo. A api valida as variáveis no start e para com uma mensagem clara se alguma estiver errada.
- Os scripts `dev` e `dev:enroll-fake` leem `.env.dev`. O script `start` não lê arquivo. Para outro ambiente, exporte as variáveis ou passe o arquivo ao `tsx` (por exemplo, `--env-file=.env.homolog`).

**Travas de produção.** Em `APP_ENV=prod`, a api **recusa subir** se houver:

- `FAKE_CANDIDATES_ENABLED=true`;
- `EXPOSE_TIMINGS=true`;
- uma chave em `COLLECTOR_SERVICE_KEYS` com menos de 32 caracteres.

Nesta entrega não há provedor real de candidatos. Com `FAKE_CANDIDATES_ENABLED=false`, como no `.env.prod.example`, a api **não sobe em prod**. Isso é esperado até o provedor real existir.

## 10. Logs e tempos

Cada batida gera um log `punch_recognition` (Pino, JSON, sem CPF). Os campos principais:

| Campo | Conteúdo |
|---|---|
| `receiptId` | Id do recibo da batida |
| `traceId` | Id de correlação |
| `outcome` | `registered` ou `fallback_required` |
| `reason` | Motivo quando o resultado é `fallback_required` |
| `candidateCount` | Quantidade de candidatos enviados à engine |
| `timingsMs` | Tempo de cada etapa: `validate`, `candidates`, `engineRoundTrip`, `engineProcessing`, `engineStages`, `dbInsert`, `total` |

Em dev, o nível é `debug` (`LOG_LEVEL`). Para ver a latência de uma requisição sem abrir o log, leia o header `Server-Timing` da resposta. Ele lista as etapas em ms: `validate`, `candidates`, `engine`, `engine-processing`, `db` e `total`.

Com `EXPOSE_TIMINGS=true` (só dev), o corpo da resposta também traz `meta.timings`. Esse campo nunca vai a produção.
