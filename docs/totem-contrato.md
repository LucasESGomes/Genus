# Totem web e busca por texto: contrato (25/11/2026)

Decisões do Otávio (25/11): o totem web **também registra ponto** (reconhecimento facial → `collector-api`), e o colaborador se cadastra no totem com **CPF + PIN** (o PIN inicial gerado no cadastro do RH). Este documento é o contrato único entre back (`apps/api`, `apps/collector-api`, `db/`) e front (`apps/portal`). Mudou aqui, muda nos dois.

## 1. Fluxo

1. O RH cadastra o colaborador com todos os dados, **sem rosto** (já existe; o cadastro devolve o PIN inicial, mostrado uma vez).
2. O RH/admin cria o totem no painel (`/rh/totens`) e recebe a **chave do aparelho** uma única vez.
3. No aparelho (celular/tablet/PC com câmera) abre-se `/totem`, **página pública** (sem login), que pede a chave na primeira vez e a guarda no `localStorage` do próprio aparelho (é a credencial dele; exceção documentada à regra de storage, como na Visage). 5 toques na marca Genus abrem a folha "Aparelho" (sem botão visível); "Desconectar este aparelho" apaga a chave.
4. Tela inicial do totem (mobile first): relógio grande, logo Genus, nome do estabelecimento, botão principal **"Registrar ponto"** e botão secundário **"Cadastrar meu rosto"**.
5. **Cadastrar meu rosto**: CPF e PIN, conferidos na hora (`POST /totem/facial/identity`) → confirmação do nome → termo de consentimento (LGPD art. 11) → captura guiada de 3 fotos (frente, levemente à esquerda, levemente à direita) → envio → "Pronto, seu rosto foi cadastrado".
6. **Registrar ponto**: câmera → captura → `collector-api` reconhece e registra → mostra nome e horário (ou orientação clara se não reconheceu). O sistema **nunca bloqueia** a marcação por regra (Portaria 671); a orientação é só sobre a foto.
7. **Calibração**: o admin clica "Calibrar totem" no painel → a sessão fica "aguardando o totem". O totem, ao consultar o contexto, entra no **assistente de calibração** (orientações e captura automática como na Visage): de 2 a 6 pessoas conhecidas com 3 fotos cada, 3 a 20 fotos de pessoas de fora e 1 a 20 fotos de rosto mostrado em tela. Ao terminar, envia tudo de uma vez; a api calcula com a engine e a sessão vira "calculada". As fotos da calibração (e as do cadastro facial) **não são guardadas** (só em memória no aparelho e no processamento); a única imagem guardada é a de tentativa de fraude (§4.1). O admin vê no painel os valores atuais × propostos, escolhe um perfil de limiar (Conservador, Balanceado ou Liberal; o recomendado vem pré-selecionado) e **aplica** ou **descarta**.

## 2. Banco `app` (migration Drizzle em `apps/api`)

`rh.aparelhos` ganha colunas (nomes por `docs/conventions/database.md`):

| Coluna | Tipo | Notas |
|---|---|---|
| `chave_hash` | `BYTEA UNIQUE NULL` | SHA-256 da chave. A chave em claro nunca é gravada |
| `chave_prefixo` | `TEXT NULL` | 8 primeiros caracteres, para o RH reconhecer qual chave é |
| `chave_gerada_em` | `TIMESTAMPTZ NULL` | |
| `ultima_conexao_em` | `TIMESTAMPTZ NULL` | atualizada por `GET /portal/totem/context` |
| `versao_app` | `TEXT NULL` | header `X-Totem-Version` do totem |
| `limiar_reconhecimento` | `REAL NULL` | NULL = padrão da engine |
| `limiar_vivacidade` | `REAL NULL` | NULL = padrão da engine |
| `calibrado_em` | `TIMESTAMPTZ NULL` | |
| `calibracao_origem_id` | `BIGINT NULL` → `aparelhos(id)` | quando copiada de outro totem |

Tabelas novas:

- `rh.sessoes_calibracao`: `id`, `conta_id`, `aparelho_id`, `status` (`aguardando` · `calculada` · `aplicada` · `descartada` · `falhou`), `iniciada_por_id`, `iniciada_em`, `calculada_em`, `resultado JSONB` (só números agregados: limiares propostos, nota de qualidade 0–100, recomendações em pt-BR, histograma; **nunca imagem nem embedding**), `decidida_por_id`, `decidida_em`, `criado_em`, `atualizado_em`. Índice único parcial: no máximo uma sessão `aguardando`/`calculada` por aparelho.
- `rh.eventos_aparelho` (só INSERT): `id`, `conta_id`, `aparelho_id`, `tipo` (`conexao`, `chave_regenerada`, `ativado`, `desativado`, `calibracao`, `cadastro_facial`, `sincronizacao`), `descricao` (sem dado pessoal), `criado_em`.

Chave: `gk_` + 40 hex (160 bits de `crypto.randomBytes`). Comparação por hash (SHA-256) com `timingSafeEqual`.

Papel de leitura para o coletor (`db/postgres/bootstrap.sh`, idempotente): `genus_coletor_leitura` com `SELECT` em `rh.aparelhos`, `rh.colaboradores`, `rh.embeddings_faciais`, `rh.chaves_empresa` (nomes reais conforme o schema). Nada mais.

## 3. API do portal (`apps/api`, prefixo `/portal`)

Erros `{ error, code }`, 404 fora do escopo, `tenantId` sempre da sessão/aparelho. IDs `number` no JSON (o front converte).

### 3.1 Painel (rh e admin; escopo de estabelecimento)

| Rota | Corpo | Resposta `data` |
|---|---|---|
| `GET /devices?establishmentId&connection` | | `Device[]` |
| `POST /devices` | `{ establishmentId, name }` | `{ device: Device, apiKey }` · 409 `APARELHO_NOME_DUPLICADO` |
| `GET /devices/:id` | | `Device` |
| `PATCH /devices/:id` | `{ name?, isActive? }` | `Device` |
| `DELETE /devices/:id` | | 204 · 409 `APARELHO_COM_BATIDAS` |
| `POST /devices/:id/regenerate-key` | | `{ device, apiKey }` |
| `GET /devices/:id/activity` | | `DeviceActivity[]` (últimos 50) |
| `GET /devices/:id/calibration` | | `DeviceCalibrationSettings` |
| `GET /devices/:id/calibration/session` | | `CalibrationSession \| null` |
| `POST /devices/:id/calibration/start` | | `CalibrationSession` · 409 `CALIBRACAO_EM_ANDAMENTO`, `APARELHO_INATIVO` |
| `DELETE /devices/:id/calibration/session` | | 204 (vira `descartada`) |
| `PUT /devices/:id/calibration/settings` | `{ recognitionThreshold, livenessThreshold }` | `DeviceCalibrationSettings` (sessão `calculada` → `aplicada`) |
| `DELETE /devices/:id/calibration/settings` | | `DeviceCalibrationSettings` (volta ao padrão) |
| `POST /devices/:id/calibration/copy` | `{ sourceDeviceId }` | `DeviceCalibrationSettings` · 404 se de outro estabelecimento |

`Device`: `{ id, establishmentId, name, isActive, connection: 'online'|'offline'|'inativo', lastSyncAt, pendingPunches, appVersion, calibrationState: 'calibrado'|'padrao'|'desatualizado', hasPunches, keyPrefix, createdAt }`. `connection`: `inativo` se `!isActive`; `online` se `ultima_conexao_em` há ≤ 2 min (Clock); senão `offline`. `pendingPunches`: 0 (o totem web envia na hora). `hasPunches`: existe registro do aparelho no `arp` (leitura). `calibrationState`: `calibrado` se tem limiares; `padrao` se NULL.

`DeviceCalibrationSettings`: `{ recognitionThreshold, livenessThreshold, effectiveRecognitionThreshold, effectiveLivenessThreshold, isCalibrated, calibratedAt, calibrationSourceDeviceId, calibrationSourceName }` (efetivo = próprio ?? padrão da engine, valores padrão em configuração da api).

`CalibrationSession`: `{ id, status, startedAt, computedAt, result: { current: { recognitionThreshold, livenessThreshold }, proposed: { recognitionThreshold, livenessThreshold }, qualityScore, recommendations: string[], distanceHistogram: { bucket, genuine, impostor }[], recommendedProfile?, profiles? } | null }`.

`recommendedProfile`: `conservative` · `balanced` · `liberal`. `profiles[]`: `{ profile, label, recognitionThreshold, genuineAcceptRate, impostorRejectRate, interpretation }` (taxas de 0 a 1; limiar com o mesmo limite e arredondamento de `proposed`), vindos de `options` e `recommended_profile` da engine. Sessões antigas não têm os dois campos: o painel aplica `proposed`. Aplicar um perfil usa o `PUT .../calibration/settings` com o `recognitionThreshold` dele e a `livenessThreshold` proposta.

### 3.2 Totem (autenticação por `X-Device-Key`, sem sessão de usuário)

Plugin novo: lê `X-Device-Key`, busca por `chave_hash`, aparelho ativo → `req.device = { tenantId, establishmentId, deviceId }`. Chave inválida ou aparelho inativo: 401 `CHAVE_APARELHO_INVALIDA` (mesma resposta). Limite de tentativas por IP para chaves inválidas.

| Rota | Corpo | Resposta `data` |
|---|---|---|
| `GET /totem/context` | | `{ device: { id, name }, establishment: { id, name }, calibration: { sessionId, status } \| null, serverTime }`; grava `ultima_conexao_em` e `versao_app` |
| `POST /totem/facial/identity` | JSON `{ cpf, pin }` | `{ firstName, alreadyEnrolled }`; confere CPF + PIN antes das fotos, com a mesma conferência, o mesmo 401 `CPF_OU_PIN_INVALIDO` e o mesmo limite de tentativas do cadastro (429 `MUITAS_TENTATIVAS`). Não grava consentimento; CPF e PIN nunca vão para log |
| `POST /totem/facial/enrollments` | multipart: `cpf`, `pin`, `consentAccepted`, `consentTextVersion`, `photos` (1–5) | `{ enrolledAt, imagesProcessed }` · mesma resposta genérica para CPF/PIN errados (401 `CPF_OU_PIN_INVALIDO`), limite de tentativas; colaborador precisa ser do estabelecimento do totem (senão a mesma resposta genérica) |
| `POST /totem/calibration` | multipart: `sessionId`, `genuine` (arquivos `p1_1.jpg`, `p1_2.jpg`, `p2_1.jpg`…), `impostor`, `attack` | `{ status: 'calculada' \| 'falhou' }`; chama engine `/calibrate/recognition` (legitimate = genuine, impostor) e `/calibrate/liveness` (real = genuine, attack); grava só o resultado agregado |

O serviço de cadastro facial existente (`modules/facial/enrollment.ts`) é reutilizado com o contexto do aparelho. As rotas antigas `/facial/*` (rh/admin) continuam.

### 3.3 Busca por texto

`q` (2 a 100 caracteres, aparado; `%` e `_` escapados; `ILIKE` sem acento quando possível, via `unaccent` se a extensão existir, senão `ILIKE` simples) em:

- `GET /employees?q=` → nome ou matrícula;
- `GET /adjustments?q=` e `GET /certificates?q=` → nome ou matrícula do colaborador (join);
- `GET /schedules?q=` → nome da escala.

`q` nunca vai para log (Pino: redigir `req.query.q`).

## 4. `collector-api`

- Nova rota **`POST /coletor/totem/batidas`**: mesmo corpo e resposta de `POST /coletor/batidas`, mas autenticada por **`X-Device-Key`** contra `rh.aparelhos` (sem chave de serviço; o navegador do totem não pode ter segredo de serviço). `GET /coletor/totem/batidas/jobs/:jobId` idem, para o totem acompanhar o processamento.
- `DbDeviceAuthenticator` (lê `rh.aparelhos` pelo papel `genus_coletor_leitura`, conexão `APP_READONLY_DATABASE_URL`) devolve o `DeviceContext` e os limiares do aparelho.
- `DbCandidateProvider`: embeddings dos colaboradores **ativos** do estabelecimento do aparelho + DEK cifrada da empresa. Substitui o fake quando `FAKE_CANDIDATES_ENABLED=false`.
- O cliente da engine envia `recognition_threshold`/`liveness_threshold` do aparelho quando não forem NULL.
- Portaria 671: a regra atual da primeira entrega sobre não identificado continua; nada novo bloqueia marcação.

### 4.1 Imagens de tentativa de fraude

Quando a engine responde `liveness_failed` (rotas `/coletor/batidas` e `/coletor/totem/batidas`), a api grava a imagem **cifrada** (AES-256-GCM; chave por HKDF da `MASTER_KEY`, info `genus:fraud-frames:v1`; arquivo = IV de 12 bytes, tag de 16 bytes, cifrado) em `FRAUD_FRAMES_DIR/<tenantId>/<AAAA-MM-DD de capturedAt, UTC>/<deviceId>-<deviceSequence>.jpg.enc`, com um `.json` de metadados (`tenantId`, `establishmentId`, `deviceId`, `deviceSequence`, `capturedAt`, `receivedAt`, `traceId`, `livenessScore`, `mime`, `sha256`, `sizeBytes`). O reenvio não regrava. Falha ao gravar não muda a resposta (só log, sem imagem). Nada é apagado automaticamente: prazo de retenção, base legal e aviso ao titular **[A CONFIRMAR]**. Acesso só por quem opera o servidor: `pnpm fraud:frames --tenant <id> [--date AAAA-MM-DD] [--out <pasta>]`. No Docker a pasta fica no volume `collector-fraudes`; trocar a `MASTER_KEY` torna as imagens antigas ilegíveis.

## 5. Front (`apps/portal`)

- Rota pública **`/totem`** fora do `AuthGate`, mobile first (360–430 px; também funciona em tablet/desktop). Chamadas mesma origem: `/portal/totem/*` (já repassado) e **`/coletor/*` → `COLLECTOR_URL`** (rewrite novo no `next.config.ts`).
- Câmera só com HTTPS/localhost, botão de parar, `MediaStream` liberado em todo desmonte; fotos só em memória.
- Painel `/rh/totens`: contrato real acima; "Calibrar" inicia a sessão e mostra "aguardando o totem…" (consulta a sessão a cada 3 s enquanto aberta); quando `calculada`, mostra atual × proposto e Aplicar/Descartar.
- Busca com debounce de 300 ms em todas as tabelas longas; `q` em estado de tela (não na URL: nome é dado pessoal).
