# Benchmark de capacidade da engine

> Medido em **29/10/2026** (20:25 a 20:39), com a ferramenta de `bench/`. Pergunta que respondeu: **quantos reconhecimentos por segundo a engine aguenta numa VPS de 1 vCPU, e quanto desse custo é criptografia?** Os números abaixo vêm dos arquivos de resultado em `REP-P/bench/results/` (não versionados). Passo a passo para repetir: `bench/README.md`.

## 1. Ambiente

| Item | Valor |
|---|---|
| CPU | AMD EPYC 9354P, **1 vCPU** visível, AES-NI, AVX2, AVX-512 |
| Plataforma | VPS com EasyPanel, **compartilhada** com os serviços da Visage (ociosos durante o teste) |
| Engine | A deste repositório, sem alteração no pipeline; só o router `/bench/*` ligado |
| RAM do processo | ~437 MB em repouso |
| Dados | **1 rosto real** (40 frames de webcam, 640 px, JPEG q85; 5 viram cadastro, os outros consultam) + até 20 000 **vetores aleatórios** de norma 1, cifrados com a DEK de bench |

## 2. Metodologia

A engine é limitada por CPU. Antes e depois de cada cenário a ferramenta lê `/bench/stats` (CPU do processo, CPU do host com *steal*) e divide pelo número de reconhecimentos:

```
teto ≈ 1000 / (CPU-ms da engine por reconhecimento)   [req/s]
```

| Cenário | O que mede |
|---|---|
| **S1** `micro` | Custo isolado de `json.loads`, hex, AES-GCM, cache e comparação por N, dentro da VPS e sem rede |
| **S2** `seq` | Latência e CPU por reconhecimento, sequencial, cache quente |
| **S5** `seq --cold` | O mesmo com cache vazio (decifra DEK e todos os embeddings a cada requisição) |
| **S3** `conc` | Teto real de req/s e degradação da latência com concorrência 1 a 16 |
| **S4** `burst` | 1000 reconhecimentos de uma vez: tempo para escoar e quantos estouram o timeout |

## 3. Resultados

### S2 e S5: um reconhecimento por vez (30 e 20 requisições por ponto)

Latência do cliente (rede + upload + parse do multipart + engine):

| Candidatos (N) | p50 | p95 | Engine (p50) | Fora da engine (p50) | Detecção | Liveness |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 66,9 ms | 75,0 ms | 42,0 ms | 24,9 ms | 27,4 ms | 11,3 ms |
| 50 | 92,3 ms | 154,9 ms | 56,5 ms | 35,8 ms | 33,1 ms | 13,0 ms |
| 100 | 82,8 ms | 106,2 ms | 45,0 ms | 37,8 ms | 29,0 ms | 12,0 ms |
| 240 | 101,1 ms | 128,0 ms | 46,5 ms | 54,6 ms | 27,4 ms | 11,5 ms |

Cache **frio** com N = 240: p50 103,0 ms; decifrar os candidatos custa **3,3 ms**. As amostras são pequenas, então a oscilação entre linhas (por exemplo N = 50) é ruído, não tendência.

### S3: concorrência (30 s por nível)

| Concorrência | Req/s (N = 1) | p50 | p95 | Req/s (N = 50) | p50 | p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 14,4 | 66 ms | 99 ms | 13,0 | 74 ms | 100 ms |
| 2 | 16,4 | 114 ms | 193 ms | – | – | – |
| 4 | 16,5 | 223 ms | 361 ms | 17,1 | 219 ms | 353 ms |
| 8 | 17,7 | 430 ms | 678 ms | 17,7 | 441 ms | 612 ms |
| 16 | **19,0** | 836 ms | 1029 ms | 16,8 | 908 ms | 1331 ms |

- **CPU da engine por reconhecimento: 41–44 ms**, independente de N e da concorrência. Teto teórico: **22,7 a 24,2 req/s**.
- **Vazão sustentada medida: ~17 a 19 req/s.** A CPU do host chegou a 95–98% (a engine usou 76–78%; o resto é Uvicorn e parse do multipart). *Steal* do hipervisor ficou entre 0,7% e 4,7%.
- Passar de concorrência 4 só aumenta a latência; a vazão já saturou.

### S1: o custo de crescer N (em processo, mediana)

| N | Payload | `json.loads` | Decifrar N | Comparação |
|---:|---:|---:|---:|---:|
| 1 | 4,2 KB | 0,02 ms | 0,02 ms | 0,02 ms |
| 50 | 213 KB | 0,38 ms | 0,49 ms | 0,07 ms |
| 240 | 1,0 MB | 1,53 ms | 2,44 ms | 0,27 ms |
| 1 000 | 4,3 MB | 12,9 ms | 21,8 ms | 1,8 ms |
| 5 000 | 21 MB | 36,5 ms | 48,4 ms | 16,4 ms |
| 10 000 | 43 MB | 127 ms | 197 ms | 13,1 ms |

AES-GCM custa **de 5 a 13 µs por embedding** (varia com a amostra). **Criptografia não é gargalo.**

### S4: rajada de 1000 requisições simultâneas (N = 50)

| | Timeout do cliente de 10 s | Timeout de 180 s |
|---|---:|---:|
| Respostas OK | **11 de 1000** (989 timeouts) | 1000 de 1000 |
| Latência p50 / p95 | 4,2 s / 9,7 s (só dos 11 que voltaram) | **62,4 s** / 75,2 s |
| Tempo para escoar | 28,5 s (parede) | **78,8 s** |
| Vazão | 0,44 req/s | 12,7 req/s |
| CPU da engine | 17,1 s | 49,9 s |
| RSS do processo | 1,26 GB | **1,46 GB** |
| Memória livre no fim | 960 MB | 883 MB |
| Resultados (timeout de 180 s) | | 915 `identified`, 29 `liveness_failed`, 56 `no_face_detected` |

## 4. O que os números decidem

1. **O gargalo é CPU de detecção e liveness (~38 de ~42 ms), não o tamanho da empresa.** Decifrar e comparar somam menos de 3 ms até N = 240; a comparação sozinha custa ~13 ms com 10 mil. Escalar a base de candidatos custa pouco CPU; o que pesa é o **upload** (4,3 KB por pessoa por requisição).
2. **O teto de ~246 candidatos por requisição chega antes do teto de CPU.** Estabelecimentos acima de ~240 funcionários exigem **galeria residente** na engine (`/identify`), prevista em `02` §4.3 (ver `face-engine.md` §7). Com ela, o payload da requisição cai para o frame (~60 KB).
3. **A premissa de capacidade do doc `02` §9 era conservadora.** O plano assumia ~2,5 a 3,5 rostos/s por vCPU compartilhada **[A MEDIR]**. Medido: **~17 a 19 req/s** sustentados, de 5 a 8 vezes mais. Mantendo 40% de folga (~10 req/s) e o pico de 0,25% dos funcionários por segundo do doc `02`, uma vCPU de reconhecimento comportaria na ordem de **4 mil funcionários**. **[A ATUALIZAR]** a tabela de tiers do `02` depois de repetir o teste na VPS de produção.
4. **O caso crítico é a rajada, não a média.** Troca de turno com 1000 pessoas no mesmo segundo leva ~79 s para escoar e deixa metade das pessoas esperando mais de 1 minuto. **A válvula do PIN (modo degradado) e o controle de admissão na engine são requisitos, não otimizações.** A espera máxima aceitável hoje no desenho é ~1,5 s (`03` §3.2).
5. **Interpretação (não medida diretamente):** com o timeout de 10 s, a engine trabalhou 17 s de CPU para entregar 11 respostas úteis, o que sugere que ela continua processando requisições que o cliente já abandonou. Por isso `face-engine.md` §7 inclui descartar requisições com conexão caída.
6. **Memória:** uma rajada de 1000 requisições de ~215 KB levou o processo de 437 MB a 1,46 GB. Se o servidor de reconhecimento tiver menos de 2 GB, o controle de admissão também protege contra falta de memória.

## 5. Limitações deste benchmark

- **Mede capacidade, não acurácia.** Só **1 pessoa real** foi cadastrada e consultada; os demais candidatos são vetores aleatórios (distância ~1,41, bem acima do limiar de 1,10), que nunca geram falso positivo. **Taxa de falsa aceitação e falsa rejeição com milhares de rostos reais não foram medidas.** Isso precisa de um conjunto de rostos reais antes de vender 1:N em empresas grandes.
- Rodou numa VPS **compartilhada**, em um único horário. O *steal* varia com a hora do dia.
- Os frames vieram de uma webcam em boa luz. Tablet barato em ambiente de obra ou campo tende a ter qualidade pior (e mais `liveness_failed` e `no_face_detected`; mesmo em boa luz, nos testes foram ~3% de `liveness_failed` e ~5 a 6% de `no_face_detected`).
- Não inclui o caminho completo do REP-P (api-coletor, mTLS, outbox, rep-core), só a engine.
- Os cenários de concorrência medem com o cliente na mesma rede; o upload de ~4,3 MB por requisição com N = 1000 **não foi exercitado** (limite de 246).

## 6. Como repetir, e o que nunca versionar

```bash
cd bench
python -m venv .venv && .venv/Scripts/python -m pip install -r requirements.txt
python bench.py init          # gera .secrets.json e engine.env (fora do git)
python bench.py set-url https://<servico>
python bench.py check
python bench.py capture --count 40   # webcam: gera frames do SEU rosto
python bench.py enroll
python bench.py gen --n 20000
python bench.py micro && python bench.py seq --n 1,50,100,240 && python bench.py conc --n 50 --levels 1,2,4,8 && python bench.py burst --n 50 --total 1000
python bench.py report        # results/report.html
```

- **Nunca versionar:** `bench/.secrets.json`, `bench/engine.env` (chaves), `bench/data/` (vetores e distratores), `bench/frames/` (**rostos**), `bench/results/`. O `.gitignore` já cobre.
- O serviço de benchmark expõe `/bench/*` e usa chaves descartáveis: **pare ou apague** ao terminar.

## 7. Próximas medições

1. Repetir na **VPS de produção** (Tier 1) e em horários diferentes, para atualizar a tabela de tiers do `02` §9.
2. Medir o **`/identify` com galeria residente** (N de 240 a 10 mil) quando existir.
3. Medir **acurácia 1:N** com conjunto de rostos reais (falso positivo e falso negativo por limiar e por N).
4. Medir a engine **com controle de admissão** sob a mesma rajada.
5. Teste de ponta a ponta do REP-P (k6: 200 batidas simultâneas, NSR sem buracos e cadeia de hash íntegra, `02` §10).
