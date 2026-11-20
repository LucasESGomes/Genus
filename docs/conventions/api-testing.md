# Testes de API com Postman

> A coleção testa a API do coletor (`apps/collector-api`) de ponta a ponta. Ela fica no repositório em **YAML** (Postman Collection **v3**, um arquivo por request), e roda no Postman (interface) e no **Postman CLI** (terminal e CI). Este documento vale para toda API do Genus que tenha coleção.

---

## 1. Arquivos

```
.postman/resources.yaml                         registra a pasta postman/ no Postman (modo Git)
postman/
  collections/Genus Coletor/
    .resources/definition.yaml                  nome, descrição, variáveis e scripts da coleção
    Health/  Punches/  Auth/  Validation/       pastas da execução automática
    Rosto real/                                 teste manual com a sua foto (fora do automático)
      <request>.request.yaml                    um request por arquivo
      .resources/<request>.resources/examples/  respostas salvas (*.example.yaml)
  environments/
    dev.environment.yaml  homolog.environment.yaml  prod.environment.yaml
  fixtures/                                     imagens sintéticas (sem rosto) usadas nos requests
```

| O quê | Versionado |
|---|---|
| Coleção, environments, `fixtures/synthetic.png` e `not-an-image.png` | Sim |
| `postman/fixtures/too-large.jpg` (> 1 MB, gerada por `node postman/fixtures/generate.mjs`) | **Não** |
| `dev-data/` (suas fotos, galeria, `probes/`) | **Não**, nunca |

Variáveis de cada environment:

| Variável | Uso |
|---|---|
| `baseUrl` | Endereço da API (`http://localhost:3001` em dev) |
| `serviceKey` | Chave de serviço (`X-Service-Key`). Tipo **secret**, vazia no arquivo |
| `maxResponseMs` | Tempo máximo, em ms, que um request pode levar |
| `stubControlUrl` | Só no runner local: controle do stub da engine. Vazia no uso manual |

## 2. Abrir no Postman

1. No Postman, abra a **pasta do repositório** (modo Git / Local View). O `.postman/resources.yaml` da raiz registra tudo que está em `postman/`: a coleção **Genus - API do Coletor** e os três environments aparecem sozinhos. Não é preciso importar arquivo.
2. **Working directory = raiz do repositório** (Settings > General > Working directory). Os arquivos dos requests (`postman/fixtures/...`, `dev-data/probes/...`) são caminhos relativos à raiz.
3. Escolha o environment no seletor do canto superior direito e preencha `serviceKey`.

Se o Postman criou pastas como `postman/.postman/`, `postman/postman/` ou `postman/globals/` (abrindo `postman/` em vez da raiz), apague-as e abra a raiz.

## 3. Escolher o ambiente

| Environment | Quando usar |
|---|---|
| `dev` | API na sua máquina (`pnpm dev`) com a engine do compose (`pnpm dev:up`) |
| `homolog` | API de homologação. Use antes de liberar uma versão |
| `prod` | Produção. Só health e leitura. Testes que gravam batidas não rodam em prod |

## 4. Chave de serviço

- Em dev, a chave é a primeira de `COLLECTOR_SERVICE_KEYS` em `apps/collector-api/.env.dev` (criada por `pnpm setup:dev`).
- Preencha `serviceKey` **só no valor atual** (Current value) do environment, no próprio Postman. Nunca no arquivo YAML.
- Não cole a chave em chat, issue, PR nem commit.

## 5. Rodar no terminal (Postman CLI)

Requer o [Postman CLI](https://learning.postman.com/docs/postman-cli/postman-cli-installation/) (comando `postman`). O Newman não lê a coleção v3 em YAML.

| Comando | O que faz |
|---|---|
| `pnpm postman:test` | Sobe o stub da engine e a API numa porta livre e roda as pastas Health, Punches, Auth e Validation no modo **estrito** |
| `pnpm postman:test -- --real-engine` | Igual, com a engine real do `.env.dev` (`pnpm dev:up` antes). Testes de batida em modo **tolerante** |

O runner usa o Postgres de dev. A chave de serviço vai num environment temporário fora do repositório, apagado no fim. Um teste que falha faz o comando sair com erro. Validação estrutural: `postman collection lint "postman/collections/Genus Coletor"` e `postman environment lint postman/environments`.

## 6. O que cada pasta cobre

| Pasta | Cobre |
|---|---|
| **Health** | `GET /health` (banco e engine) e `GET /health/ready` (banco) |
| **Punches** | `POST /coletor/batidas`: registrada, `fallback_required`, reenvio idempotente (mesmo `receiptId`), hora divergente e duplicidade (avisos, sem bloquear) |
| **Auth** | Chave ausente ou inválida (401 `UNAUTHORIZED`, mesma mensagem nos dois casos) |
| **Validation** | Campos inválidos (400 `VALIDATION_ERROR`), imagem inválida (400 `INVALID_IMAGE`) e acima do limite (413 `IMAGE_TOO_LARGE`) |
| **Rosto real** | Manual. Batida com `dev-data/probes/proxima-batida.jpg`, uma foto sua que a engine nunca viu (gerada por `pnpm dev:enroll-fake`). Esperado: `registered` |

## 7. Como os testes funcionam

| Teste | O que confere |
|---|---|
| **Status** | O código HTTP esperado para o caso |
| **Schema** | Campos e tipos da resposta, sem campos que não devem sair (CPF, cifrados, embedding) |
| **Server-Timing** | Em toda resposta de batida (exceto 401), o header traz as etapas (`validate`, `candidates`, `engine`, `engine-processing`, `db`, `total`) |
| **Tempo** | Nenhum request passa de `maxResponseMs` |
| **Estrito × tolerante** | Com `stubControlUrl`, o pre-request põe o stub no cenário do teste e o resultado é exato. Sem ele (engine real, imagem sintética sem rosto), as batidas aceitam `registered` ou `fallback_required` e validam o schema |

## 8. Regra: todo endpoint novo entra no mesmo PR com Postman

**Todo endpoint novo entra no mesmo PR com requests e testes Postman.** Sem isso, o PR não está pronto.

Checklist do PR:

- [ ] Request (`*.request.yaml`) na pasta certa, com **descrição** (o que faz, quem pode chamar, parâmetros).
- [ ] **Exemplo salvo** (`*.example.yaml`) para o sucesso e para cada erro.
- [ ] Testes de **status**, de **schema** e de **tempo** (`maxResponseMs`).
- [ ] **Casos de erro**: validação, autenticação e falha de dependência (use `stubControlUrl` quando precisar).
- [ ] `Server-Timing`, se o endpoint for de batida ou de reconhecimento.
- [ ] Mudou um contrato existente? A coleção muda no mesmo PR.
- [ ] `postman collection lint` sem erro nem aviso, e `pnpm postman:test` passa localmente.

A coleção é revisada como código: um request por arquivo, então o diff mostra exatamente o que mudou junto com a API.
