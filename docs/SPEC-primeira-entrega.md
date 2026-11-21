# Primeira entrega da api do coletor: decisões

> Escopo mínimo: receber uma foto, reconhecer o rosto entre candidatos fictícios pela engine, medir cada etapa e gravar a batida em `arp.entradas` (`pendente`). **Nada consome `entradas` ainda.** Contratos em `packages/shared`.

## 1. Fluxo

`POST /coletor/batidas` (multipart) → chave de serviço → validação → idempotência → `CandidateProvider` → engine `/recognize` → `INSERT` em `arp.entradas` → recibo.

| Passo | Decisão |
|---|---|
| Autenticação | Header `X-Service-Key`, comparação em tempo constante contra `COLLECTOR_SERVICE_KEYS` (lista, para rotação). Falha: 401 `UNAUTHORIZED`, mesma mensagem para ausente e inválida |
| Contexto do aparelho | `DeviceAuthenticator` devolve `{ tenantId, establishmentId, deviceId }` fixos de configuração de dev. **Provisório:** será trocado por certificado mTLS / token do aparelho validado contra o banco `app` |
| Validação | `image` JPEG/PNG, até `MAX_IMAGE_BYTES` (1 MB), mime declarado **e** magic bytes; `deviceSequence` inteiro > 0; `capturedAt` ISO 8601 com fuso. Erro: 400 (`VALIDATION_ERROR`, `INVALID_IMAGE`) ou 413 (`IMAGE_TOO_LARGE`) |
| Idempotência | Antes de reconhecer: `(aparelho_id, sequencia_aparelho)` já existe → 200 com o **mesmo** `receiptId` e `markedAt`. Na corrida, `INSERT ... ON CONFLICT DO NOTHING RETURNING` + `SELECT` |
| Candidatos | Sempre do servidor (`CandidateProvider`), **nunca** do corpo. Atual: `FakeCandidateProvider` (20 pessoas fictícias, ou a galeria real de `dev-data/gallery.json`) |
| Engine | Cliente com semáforo (`ENGINE_MAX_CONCURRENCY`, padrão 4) e timeout (`ENGINE_TIMEOUT_MS`, padrão 800). `trace_id` = `id_publico` pretendido da entrada |
| Resultado | `identified` → grava e responde `registered` com `receiptId` e `jobId` (`<aparelhoId>-<sequencia>`, o id do job em `punches`; o mesmo no reenvio e mesmo se a publicação falhar). Qualquer outro → `fallback_required` + `reason`, **HTTP 200, nada gravado** |
| Consulta | `GET /coletor/batidas/jobs/:jobId` (status do banco, NSR de `evidencias` e estado do job no BullMQ, só diagnóstico; Valkey fora vira `queue.state = unavailable`, sem derrubar a consulta) e `GET /coletor/batidas?employeeId=` (paginada). Só leitura e sempre filtrada pela conta do aparelho. A migration `0003` dá a `arp_collector` `SELECT` em `evidencias` |

## 2. Nunca bloquear

| Situação | Resposta |
|---|---|
| `face_not_recognized` / `liveness_failed` / `no_face_detected` / `multiple_faces_detected` | 200 `fallback_required`, `reason` = `not_recognized` / `liveness_failed` / `no_face` / `multiple_faces` |
| Engine fora, timeout, 5xx | 200 `fallback_required`, `engine_unavailable` |
| `/health` da engine `degraded` (liveness desligado) | 200 `fallback_required`, `engine_degraded` (o estado é cacheado por alguns segundos) |
| Mais de 240 candidatos | 200 `fallback_required`, `too_many_candidates`, sem chamar a engine |
| `capturedAt` a mais de 30 s do servidor, ou no futuro | Registra com a hora do **servidor**, `eh_hora_divergente = true`, warning `clock_divergence` |
| Mesmo CPF com entrada nos últimos 60 s | **Registra**, warning `possible_duplicate` |
| Engine fora do contrato (401 de chave errada, 400 de imagem não decodificável, 413/429 de proxy, JSON fora do schema, `person_id` fora da lista) | 200 `fallback_required`, `engine_unavailable`, com log `error`. Nada gravado |
| Falha na checagem de duplicidade | Segue sem o aviso e grava (log `warn`) |
| Engine 422 (InvalidTag do embedding) ou 400 "Erro ao descriptografar DEK" | `EngineIntegrityError`: log `error` com `severity: critical`, **500 `INTERNAL_ERROR`**. Jamais "não identificado" |
| Postgres fora do ar | 500 `INTERNAL_ERROR`: sem banco não há como registrar; o aparelho mantém a batida local e reenvia |

O aparelho trata qualquer resposta não 200 como modo degradado (PIN). A batida nunca se perde porque o aparelho a grava localmente antes de enviar.

## 3. Banco `arp`

- Migration `db/arp/migrations/0001_cria_entradas.sql`, SQL à mão. Só a tabela `entradas` (colunas em `database.md` §4; `UNIQUE (aparelho_id, sequencia_aparelho)`; índice parcial `status = 'pendente'`).
- Papel `arp_collector`: **só INSERT e SELECT** em `entradas`. O dono aplica as migrations.
- A api faz só `INSERT` e `SELECT`. **Toda query filtra `conta_id`.** SQL puro com `pg`, sem ORM.
- **[A CONFIRMAR]** A `UNIQUE (aparelho_id, sequencia_aparelho)` não inclui `conta_id`, contrariando `database.md` §6. Mantida assim porque o aparelho é global (um aparelho pertence a uma única conta) e é a chave do `jobId` em `02` §4.5. Revisitar quando a tabela de aparelhos existir no `app`.
- `// FILA: publicar aqui, depois do commit e fora da transação (a planejar)` marca o ponto exato da futura publicação. Sem BullMQ/Valkey nesta entrega.

## 4. Medição

Cada batida gera **um** log `punch_recognition` (Pino, JSON, sem CPF) com `receiptId`, `traceId`, `outcome`, `reason`, `candidateCount` e `timingsMs = { validate, candidates, engineRoundTrip, engineProcessing, engineStages, dbInsert, total }`. A resposta leva `Server-Timing`. O corpo só inclui `meta.timings` com `EXPOSE_TIMINGS=true` (proibido em prod).

## 5. Ambientes

`APP_ENV` = `dev | homolog | prod`, validado com Zod no start. Em `prod` a api **recusa subir** com `FAKE_CANDIDATES_ENABLED=true`, `EXPOSE_TIMINGS=true` ou chave de serviço com menos de 32 caracteres. `LOG_LEVEL` padrão `info` em prod e `debug` em dev.

## 6. Achados sobre a engine (código, não a doc antiga)

- `/recognize` recebe campos soltos: `tenant_id`, `image`, `candidates` (string JSON), `dek_ct`, `dek_iv`, `dek_tag`, `dek_key_version`, `trace_id`. A doc dizia `tenant_dek` como objeto.
- Status de não reconhecido é `face_not_recognized` (a doc dizia `not_identified`).
- Falha ao decifrar a **DEK** volta como **400**, não 422; só o embedding adulterado volta 422. O cliente trata os dois como integridade.
- Sem modelos de liveness a engine sobe com liveness desligado e `/health` = `degraded`.

## 7. Fora desta entrega

Fila (BullMQ/Valkey), rep-core, NSR, hash, `registros`, `evidencias`, signer, PDF, QR, lotes offline, modo PIN, portal, banco `app`, Drizzle, mTLS, nginx, imagem persistida. A api roda com `tsx` (sem build/empacotamento de produção ainda).
