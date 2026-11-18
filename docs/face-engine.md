# Motor facial (`services/face-engine`)

> Serviço Python que identifica e verifica rostos. É o **motor da Visage empacotado como serviço**, sem alterar o pipeline. Medições de capacidade em `benchmark.md`.

## 1. Origem

| Item | Valor |
|---|---|
| Código | `services/face-engine/`, cópia de `REP-P/engine` no commit `d80c5dd` ("Bench: gravar frames da captura sem cv2.imwrite") |
| Quem originou | `visage/face_engine`, que **não foi modificada** |
| O que mudou em relação à Visage | Reorganização em `app/` (api, core, engine, infra, services, utils) e o router `/bench/*`, desligado por padrão |
| Não foi copiado | `models/` (ONNX, baixados no start), `.env`, `__pycache__`, todos os dados do benchmark |

O histórico do Git do `REP-P` **não** veio junto; este repositório começa limpo.

## 2. Pipeline

`/recognize` executa, nesta ordem:

1. **Decodificação** (OpenCV) → HTTP 400 se a imagem for inválida.
2. **Detecção + alinhamento:** SCRFD (InsightFace `buffalo_s`, restrito a 2 módulos). Várias faces → `multiple_faces_detected`.
3. **Anti-spoofing em 3 camadas:** MiniFASNet V1 (crop 2,7×) + V2 (crop 4,0×) e **análise HSV de saturação** (detecta telas). Abaixo do limiar → `liveness_failed`.
4. **Embedding:** ArcFace R50, vetor de 512 `float32` normalizado em L2.
5. **Resolução dos candidatos:** busca no cache, decifra o que faltar, insere no cache.
6. **Comparação vetorizada** (NumPy): distância euclidiana contra todos os candidatos. `confidence = max(0, 1 − distância/1,5)`.

Limiares padrão: `RECOGNITION_THRESHOLD = 1.10` (distância; menor é mais parecido) e `LIVENESS_THRESHOLD = 0.85`. Ambos podem ser sobrescritos por requisição (`thresholds`).

Status devolvidos: `identified`, `not_identified`, `liveness_failed`, `no_face_detected`, `multiple_faces_detected`.

## 3. Endpoints

Todos exigem `X-API-Key` (exceto `/health`). Sem a chave, HTTP 401.

| Método e rota | Função |
|---|---|
| `GET /health` | Estado dos modelos carregados |
| `POST /recognize` | Detecta, valida vivacidade e compara o rosto com os **candidatos enviados** |
| `POST /embeddings/register` | Gera o embedding de uma pessoa a partir de até 5 imagens (média renormalizada) e devolve cifrado |
| `DELETE /embeddings/{tenant_id}/{person_id}` | Invalida o embedding em cache (pessoa removida ou recadastrada) |
| `POST /cache/warm` | Pré-popula o cache com embeddings cifrados antes do pico |
| `DELETE /cache/dek/{tenant_id}` | Invalida a DEK em cache (rotação de chave) |
| `POST /detect` | Só detecção |
| `POST /enroll/frame` · `POST /enroll/finalize` | Cadastro multi-frame com liveness rigoroso |
| `POST /calibrate/liveness` · `POST /calibrate/recognition` | Ferramentas de calibração de limiares |
| `GET /bench/stats` · `POST /bench/reset` · `POST /bench/micro` | **Só com `BENCH_ENDPOINTS=true`.** Nunca em produção |

**`POST /recognize` (multipart):** `tenant_id`, `tenant_dek` (`{dek_ct, dek_iv, dek_tag, key_version}`), `candidates` (lista de `{person_id, embedding_iv, embedding_tag, embedding_ct, key_version}`, em hex), `thresholds` opcional, `image`. `person_id` aceita inteiro ou texto.

**Resposta:** `status`, `person_id`, `confidence`, `liveness_score` (mais os escores brutos V1/V2 e HSV), `processing_ms` e `timings_ms` por etapa.

## 4. Configuração (variáveis de ambiente)

| Variável | Padrão | Observação |
|---|---|---|
| `MASTER_KEY` | **obrigatória** | 64 hex (256 bits). Idêntica à do backend. Valida no start |
| `ENGINE_API_KEY` | **obrigatória** | Autentica o backend |
| `RECOGNITION_THRESHOLD` | `1.10` | |
| `LIVENESS_THRESHOLD` | `0.85` | |
| `LIVENESS_MODEL_V1_PATH` / `_V2_PATH` | `./models/2.7_80x80_MiniFASNetV1.onnx` / `4_0_80x80_MiniFASNetV2.onnx` | Baixados por `scripts/download_models.py` |
| `DEK_CACHE_TTL_HOURS` | `1` | TTL da DEK em RAM |
| `PORT` | `8001` | |
| `ONNX_INTRA_OP_THREADS` · `ONNX_INTER_OP_THREADS` | `1` · `1` | Ver `services/face-engine/docs/PERFORMANCE.md` |
| `CV2_NUM_THREADS` · `ENGINE_THREAD_POOL_SIZE` | `1` · `1` | Alinhar à cota de CPU. Defaults assumem **1 vCPU** |
| `DETECTION_MAX_SIZE` | `640` | Maior lado antes da detecção |
| `SAVE_AUDIT_FRAMES` | `false` | ~90–200 ms de CPU por requisição. Só para depurar |
| `BENCH_ENDPOINTS` | `false` | **Nunca ligar em produção** |

As variáveis `OMP/OPENBLAS/MKL/NUMEXPR_NUM_THREADS` ficam no `Dockerfile` (default 1). Mudar a cota de CPU exige ajustar **todas** juntas.

## 5. Criptografia

Envelope encryption: a `MASTER_KEY` (KEK) decifra a DEK do tenant, que vem na requisição e fica em cache por 1 h, **só em RAM**. A DEK decifra os embeddings (AES-256-GCM, 12 B de IV, 16 B de tag). Embedding em claro nunca toca disco. **`InvalidTag` vira HTTP 422 e nunca é silenciado.** Detalhes em `docs/conventions/security-lgpd.md`; documento do serviço: `services/face-engine/docs/DEK_PER_TENANT.md`.

## 6. Restrições operacionais

- **`workers=1` é obrigatório.** O cache de embeddings vive na memória do processo e não tem TTL; com N workers, um `DELETE` invalidaria só um deles. A concorrência vem do pool de threads interno.
- **Máximo de ~246 candidatos por requisição.** O Starlette limita cada campo multipart a 1 MB e cada candidato cifrado em hex ocupa ~4,3 KB. Acima disso, HTTP 400 `Part exceeded maximum size of 1024KB`.
- **O cache não elimina o payload.** `/recognize` exige `embedding_ct` de todos os candidatos em **toda** requisição, mesmo com cache quente. O cache só poupa a decifragem.
- **Sem controle de admissão.** A engine aceita todas as requisições que chegam e as processa até o fim, mesmo que o cliente já tenha desistido (ver `benchmark.md`, rajada).
- **Modelos não vão para o Git.** O container baixa no start (`CMD` do `Dockerfile`).
- **Stateless em relação ao banco.** A engine nunca conecta ao PostgreSQL.

## 7. Lacunas em relação ao REP-P (`02` §4.3)

O desenho do REP-P prevê `POST /identificar` (1:N na galeria do estabelecimento) e `POST /verificar` (1:1). O motor atual cobre isso só em parte:

| Necessidade | Hoje | Proposta |
|---|---|---|
| **Identificação 1:N sem enviar candidatos** | Não existe. `/recognize` recebe os candidatos no corpo (teto ~246) | Novo `POST /identify` com **galeria residente** por `establishment_id`, carregada por evento. Tira o teto de 246 e o custo de upload (~4,3 KB por pessoa por batida). Custo de memória: ~2 KB por embedding (10 mil = ~20 MB). Comparação com 10 mil medida em ~13 ms |
| Verificação 1:1 | **Já possível:** `/recognize` com 1 candidato (~42 ms de engine) | Opcional: rota `/verify` só como açúcar de contrato |
| Cadastro | `POST /embeddings/register` (até 5 imagens) | Manter. Usar `/enroll/*` para o fluxo multi-frame |
| **Admissão e contrapressão** | Não existe | Limite de requisições em andamento; acima dele, `503` com `Retry-After`; descartar requisição cuja conexão já caiu. Alimenta a válvula de PIN do modo degradado |
| Métricas de produção | Só `/bench/*` (proibido em produção) | Endpoint de métricas próprio (fila, latência por etapa, RSS) |
| Invalidação entre processos | Não existe (por isso `workers=1`) | Só necessária se um dia precisar de mais de 1 worker |

## 8. Documentação interna do serviço (e o que está defasado)

Em `services/face-engine/`:

- `docs/PERFORMANCE.md`, `DEK_PER_TENANT.md`, `DEPLOYMENT.md`, `API_ENDPOINTS_POSTMAN.md`, `MULTIPLE_FACES_DETECTION.md`: **vigentes**.
- `README.md`, `setup.sh`, `setup.bat`: **defasados.** Descrevem a estrutura antiga (`main.py` na raiz), citam `AES_KEY` e o modelo único `minifas.onnx`. O código atual usa `app.main:app`, `MASTER_KEY` e dois modelos (V1 e V2). Não os use; siga a §9.
- `.env.example`: o valor de `MASTER_KEY` é fictício e **não é hexadecimal válido**. Gere uma chave real.

## 9. Rodar e testar

```bash
cd services/face-engine
# gere as chaves, exporte (ou use .env): MASTER_KEY (64 hex) e ENGINE_API_KEY
python -c "import os; print(os.urandom(32).hex())"
pip install -r requirements.txt
python scripts/download_models.py
uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 1
```

Ou `docker build` com o `Dockerfile` (já baixa os modelos e sobe com `workers=1`). Documentação interativa em `http://localhost:8001/docs`.

```bash
py -3 -m pytest                 # tier puro (numpy/cryptography): roda em qualquer máquina
py -3 -m pytest -m integration  # exige a engine no ar (ENGINE_API_KEY, ENGINE_BASE_URL)
py -3 -m pytest -m models       # pipeline completo com ONNX (roda no container)
```
