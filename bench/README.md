# Benchmark da face engine

Mede quantos reconhecimentos por segundo a engine aguenta numa VPS de 1 vCPU e
quanto desse custo é criptografia. A engine roda **sem alteração no pipeline**
(cópia de `visage/face_engine`); a única adição é o router `/bench/*`, ligado
por `BENCH_ENDPOINTS=true`, que expõe contadores de CPU/RAM, reset de cache e
um microbench da criptografia.

## Como a capacidade é medida

A engine é limitada por CPU e a VPS tem 1 vCPU. Antes e depois de cada
cenário a ferramenta lê `/bench/stats` (CPU do processo, CPU do host com
*steal*) e divide pela quantidade de reconhecimentos:

```
teto ≈ 1000 / (CPU-ms da engine por reconhecimento)   [req/s]
```

Esse número não depende da sua internet. Os cenários com concorrência
(`conc`, `burst`) confirmam o teto na prática — mas só enquanto o seu upload
aguentar: cada request sobe o frame (~60 KB) **mais todos os candidatos
cifrados (~4,3 KB por pessoa)**. Com N=1000 são ~4,3 MB por reconhecimento.

## Limite de candidatos por request

A engine atual **recusa requisições com mais de ~246 candidatos** (HTTP 400,
`Part exceeded maximum size of 1024KB`): o Starlette limita cada campo de
formulário multipart a 1 MB, e cada candidato cifrado em hex ocupa ~4,3 KB.
Por isso `seq`/`conc`/`burst` vão até N=240. Para N maior, `micro` mede a
parte criptográfica em processo (até 10 000), sem esse limite — é o dado
para decidir como o REP-P vai lidar com empresas acima de ~240 funcionários.

## Passo a passo

```bash
cd bench
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # Windows
```

1. **Chaves** — `python bench.py init` gera `.secrets.json` (MASTER_KEY,
   API key e a DEK do tenant de bench, cifrada) e `engine.env`. Os dois ficam
   fora do git. Cole o conteúdo de `engine.env` na aba *Environment* do
   serviço no EasyPanel.
2. **URL** — `python bench.py set-url https://<dominio-do-servico>`
3. **Conferir** — `python bench.py check`: health dos modelos, modelo de CPU,
   AES-NI/AVX2, memória livre e a configuração de threads.
4. **Rosto** — `python bench.py capture --count 40`: abre a webcam e salva
   40 frames (640px, JPEG q85, igual ao totem). Boa luz, rosto de frente,
   mexendo levemente a cabeça. Os 5 primeiros viram cadastro, o resto consulta.
5. **Cadastro** — `python bench.py enroll`
6. **Distratores** — `python bench.py gen --n 20000`: vetores aleatórios de
   norma 1 cifrados com a DEK de bench. Custam o mesmo que rostos reais e não
   dão falso positivo (distância ~1,41 > threshold 1,10).
7. **Cenários**

| Comando | Cenário | Responde |
|---|---|---|
| `micro` | S1 | Custo isolado de json.loads, hex, AES-GCM, cache e comparação por N — dentro da VPS, sem rede |
| `seq --n 1,50,100,240` | S2 | Latência e CPU por reconhecimento conforme cresce o número de candidatos (cache quente) |
| `seq --n 50,240 --cold` | S5 | O mesmo com cache vazio: decifra DEK e todos os embeddings a cada request |
| `conc --n 50 --levels 1,2,4,8` | S3 | Teto real de req/s e como a latência degrada |
| `burst --n 50 --total 1000` | S4 | 1000 reconhecimentos de uma vez: quanto tempo para escoar e quantos estouram 10s |

8. **Relatório** — `python bench.py report` → `results/report.html`

Se aparecer muito `liveness_failed`, a requisição sai antes do ArcFace e da
comparação, e o custo fica subestimado: recapture com mais luz ou rode com
`--liveness-threshold 0.5`.

## Lendo os números

- `engine_processing_ms` vem da própria engine (`processing_ms`); a diferença
  para a latência do cliente é rede + TLS + upload + fila + parse do
  multipart (este último não entra no `timings_ms`).
- `detection_ms` inclui o ArcFace: o `FaceAnalysis.get` detecta e extrai o
  embedding na mesma chamada, por isso `embedding_ms` fica perto de zero.
- `host_steal_pct` alto significa que o hypervisor está tirando CPU da VPS —
  o resultado varia com a hora do dia.
- A VPS também roda os serviços da visage. Eles ficam ociosos durante o
  teste, mas `host_busy_pct` acima do `engine_cpu_util_pct` mostra quanto
  outros processos consumiram.

## Ao terminar

Pare ou apague o serviço de bench no EasyPanel: ele expõe `/bench/*` e usa
chaves descartáveis. Apague `frames/` se não quiser manter seu rosto em disco.
