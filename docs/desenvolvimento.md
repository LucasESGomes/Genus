# Desenvolvimento local

> Como subir o Genus na sua máquina: banco, motor facial e a api do coletor. Os comandos são da raiz do repositório, salvo quando o texto disser outra pasta.

---

## 1. Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node.js | **24 LTS**, conforme `.nvmrc` (`24.14.1`) | Com `nvm`: `nvm use` |
| pnpm | **10** | `package.json` fixa a versão em `packageManager` (pnpm 10.20.0). Use `corepack enable` |
| Docker | Recente, com Compose v2 | Obrigatório para o banco, a engine e os testes (Testcontainers) |

## 2. Primeira vez

### 2.1 Copiar os arquivos de ambiente

```bash
cp infra/.env.example infra/.env
cp apps/collector-api/.env.dev.example apps/collector-api/.env.dev
```

Esses arquivos ficam fora do Git (`.env`, `.env.*`). Nunca os versione.

### 2.2 Gerar os segredos

| Segredo | Onde entra | Tamanho | Comando |
|---|---|---|---|
| `MASTER_KEY` | `infra/.env` **e** `apps/collector-api/.env.dev` | 64 hex (32 bytes) | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ENGINE_API_KEY` | `infra/.env` **e** `apps/collector-api/.env.dev` | 32 caracteres ou mais | `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `COLLECTOR_SERVICE_KEYS` | `apps/collector-api/.env.dev` (lista separada por vírgula) | 32 caracteres ou mais, cada uma | o mesmo comando acima |
| Senhas dos papéis do Postgres | `infra/.env` (`ARP_OWNER_PASSWORD`, `ARP_COLLECTOR_PASSWORD`) e nas URLs de `.env.dev` | à sua escolha | o mesmo comando acima |

Regras:

- **`MASTER_KEY` e `ENGINE_API_KEY` têm que ser iguais** nos dois arquivos. A engine e a api usam os mesmos valores.
- A senha do `POSTGRES_PASSWORD` do superusuário vai só em `infra/.env`.
- As senhas de `arp_owner` e `arp_collector` entram nas URLs de conexão:
  - `ARP_MIGRATION_DATABASE_URL` usa `ARP_OWNER_PASSWORD`.
  - `ARP_DATABASE_URL` usa `ARP_COLLECTOR_PASSWORD`.
  - O comando com `base64url` gera só letras, números, `-` e `_`, que não precisam de escape na URL. Se usar outra senha, codifique-a (percent-encoding).

### 2.3 Conferir

Antes de subir, confira que nenhum valor ainda começa com `TROQUE_`. A api valida `MASTER_KEY` (64 hex) no start e não sobe com o placeholder. A engine também valida essa chave no start.

## 3. Subir o banco e a engine

```bash
# Só o Postgres (a api sobe, mas sem a engine responde `fallback_required`)
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d postgres

# Com a engine exposta em 127.0.0.1:8001 (necessário para o fluxo de reconhecimento)
docker compose -f infra/docker-compose.yml --env-file infra/.env --profile dev up -d
```

Pontos de atenção:

- O script `infra/postgres/init` cria os papéis `arp_owner` e `arp_collector` e os bancos `arp` e `app`. Ele roda **só na primeira subida** do volume `pgdata`. Se trocar uma senha depois, o volume precisa ser recriado (`docker compose ... down -v`). Isso apaga os dados locais.
- A primeira subida da engine baixa os modelos ONNX. Pode levar alguns minutos. O healthcheck tem tolerância de 300 s.
- Verifique a engine com `curl http://127.0.0.1:8001/health`. O esperado é `"status": "ok"`. Veja também `docs/face-engine.md` §3.

## 4. Aplicar a migration do banco arp

```bash
pnpm install
pnpm db:migrate:arp
```

O comando usa `ARP_MIGRATION_DATABASE_URL` do ambiente. Ele precisa estar exportada no shell, porque o comando não lê `.env.dev`. Use o papel `arp_owner`. Nunca use `arp_collector` para migrar.

A migration aplicada não muda mais. Nova alteração de banco vira uma nova migration.

## 5. Rodar a api do coletor

```bash
pnpm dev
```

O script `dev` lê `apps/collector-api/.env.dev`. Ele recarrega ao salvar um arquivo. A api sobe na porta `PORT` (3001 no exemplo).

Teste rápido:

```bash
curl http://localhost:3001/health
```

`GET /health` devolve o estado da api, do banco e da engine. Se a engine estiver fora, a api continua no ar e responde `fallback_required` para as batidas. Isso é esperado.

## 6. Testes e verificações

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

`pnpm -r test` exige o Docker em execução. Os testes de banco sobem um Postgres temporário com Testcontainers. Ele não usa o `infra/`.

## 7. Postman

A coleção testa a API do coletor. Veja o guia completo em [`conventions/api-testing.md`](conventions/api-testing.md).

```bash
pnpm postman:test                    # sobe o stub da engine e a api, roda no environment dev
pnpm postman:test -- --real-engine   # usa a engine real (suba com --profile dev antes)
```

Importe no Postman a coleção `postman/genus-collector.postman_collection.json` e o environment `postman/environments/dev.postman_environment.json`. Preencha `serviceKey` só no valor atual do environment, nunca no arquivo.

## 8. Benchmark e dados de teste

```bash
pnpm bench:punch -- --n 50 --concurrency 4                  # imagem sintética
pnpm bench:punch -- --n 50 --concurrency 4 --image caminho  # foto real
```

- Sem `--image`, o script usa uma imagem sintética. Ela mede só a etapa de **detecção**. Não mede o reconhecimento.
- Para o pipeline completo (detecção, liveness e comparação com candidatos):
  1. Coloque uma foto por pessoa em `dev-data/faces/` (um arquivo por pessoa).
  2. Rode `pnpm dev:enroll-fake`. Ele gera a galeria em `dev-data/gallery.json`, que a api usa como candidatos.
  3. Rode o benchmark com `--image` apontando para uma foto de alguém cadastrado.
- **`dev-data/` nunca vai ao Git.** Ela tem rostos e embeddings. Já está no `.gitignore`. Não copie essas fotos para outras pastas do repositório.
- Os resultados do benchmark ficam fora do Git, como em `bench/` (ver `docs/benchmark.md`).

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
