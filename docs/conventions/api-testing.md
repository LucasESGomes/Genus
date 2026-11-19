# Testes de API com Postman

> A coleção testa a API do coletor (`apps/collector-api`) de ponta a ponta. Os mesmos arquivos rodam no Postman, na interface, e no Newman, no terminal e no CI. Este documento vale para toda API do Genus que tenha coleção.

---

## 1. Arquivos

| Arquivo | Para que serve | Versionado |
|---|---|---|
| `postman/genus-collector.postman_collection.json` | Requests, descrições, exemplos salvos e testes | Sim |
| `postman/environments/dev.postman_environment.json` | Variáveis do ambiente local | Sim |
| `postman/environments/homolog.postman_environment.json` | Variáveis da homologação | Sim |
| `postman/environments/prod.postman_environment.json` | Variáveis de produção | Sim |
| `postman/*.local.json` | Cópias locais, se precisar | **Não** (`.gitignore`) |
| `newman/` | Saída do Newman | **Não** (`.gitignore`) |

Variáveis de cada environment:

| Variável | Uso |
|---|---|
| `baseUrl` | Endereço da API (ex.: a api local em dev) |
| `serviceKey` | Chave de serviço (`X-Service-Key`). Tipo **secret**, vazia no arquivo |
| `maxResponseMs` | Tempo máximo, em ms, que um request pode levar |
| `stubControlUrl` | Endereço do controle do stub da engine, usado pelos testes de falha |

## 2. Importar no Postman

1. Abra o Postman e clique em **Import**.
2. Importe `postman/genus-collector.postman_collection.json`.
3. Importe os environments que vai usar (`dev`, `homolog` ou `prod`).
4. Escolha o environment no seletor do canto superior direito.

## 3. Escolher o ambiente

| Environment | Quando usar |
|---|---|
| `dev` | API rodando na sua máquina (`pnpm dev`) e, se for o caso, a engine do compose com `--profile dev` |
| `homolog` | API de homologação. Use antes de liberar uma versão |
| `prod` | Produção. Use só para checar health e leitura. Testes que gravam batidas não rodam em prod |

Confira sempre o environment selecionado antes de enviar um request. O nome aparece no seletor.

## 4. Chave de serviço

- Preencha `serviceKey` **só no valor atual** (**Current value**) do environment, no próprio Postman.
- Nunca coloque a chave no **Initial value** nem no arquivo JSON. O campo é do tipo secret e o Postman não o exporta.
- Use uma das chaves de `COLLECTOR_SERVICE_KEYS` do ambiente correspondente.
- Gere uma chave nova com o comando de `docs/desenvolvimento.md`.
- Não cole a chave em chat, issue, PR nem commit.

## 5. Rodar com Newman

Newman é o runner de linha de comando do Postman. Ele roda a mesma coleção do terminal.

| Comando | O que faz |
|---|---|
| `pnpm postman:test` | Sobe o stub da engine e a API, e roda a coleção no environment `dev` |
| `pnpm postman:test -- --real-engine` | Igual, mas usa a engine real. Antes, suba a engine com o compose (`--profile dev`) |

Um teste que falha faz o comando sair com erro. No CI, isso bloqueia o merge.

## 6. O que cada pasta cobre

| Pasta | Cobre |
|---|---|
| **Health** | `GET /health` (banco e engine) e `GET /health/ready` (banco) |
| **Punches** | `POST /coletor/batidas`: reconhecido (`registered`), `fallback_required` (não reconhecido, sem rosto, engine fora, engine degradada) e idempotência (mesmo aparelho e sequência) |
| **Auth** | Chave ausente ou inválida (401 `UNAUTHORIZED`, mesma mensagem para as duas) |
| **Validation** | Campos inválidos (400 `VALIDATION_ERROR`), imagem inválida (400 `INVALID_IMAGE`) e imagem acima do limite (413 `IMAGE_TOO_LARGE`) |

## 7. Como os testes funcionam

| Teste | O que confere |
|---|---|
| **Status** | O código HTTP esperado para o caso |
| **Schema** | Campos e tipos da resposta, sem campos que não devem sair (cifrados, hashes, embedding) |
| **Server-Timing** | Em toda resposta de batida, o header traz as etapas medidas (`validate`, `candidates`, `engine`, `engine-processing`, `db`, `total`) |
| **Tempo** | Nenhum request passa de `maxResponseMs` |
| **Stub** | `stubControlUrl` põe o stub da engine no cenário do teste (fora do ar, lenta, erro 5xx, `degraded`). Assim o caso de falha roda sem depender da engine real |

## 8. Regra: todo endpoint novo entra no mesmo PR com Postman

**Todo endpoint novo entra no mesmo PR com requests e testes Postman.** Sem isso, o PR não está pronto.

Checklist do PR:

- [ ] Request na pasta certa, com **descrição** (o que faz, quem pode chamar, parâmetros).
- [ ] **Exemplo salvo** (Save as example) para o caso de sucesso e para cada erro.
- [ ] Testes de **status**, de **schema** e de **tempo** (`maxResponseMs`).
- [ ] **Casos de erro**: validação, autenticação e falha de dependência (use `stubControlUrl` quando precisar).
- [ ] `Server-Timing`, se o endpoint for de batida ou de reconhecimento.
- [ ] Mudou um contrato já existente? A coleção muda no mesmo PR.
- [ ] `pnpm postman:test` passa localmente.

A coleção é revisada como código: alteração em request ou teste vai no diff, junto com a mudança da API.
