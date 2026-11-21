# Fila de batidas: guia didático

> Para quem nunca trabalhou com filas. Explica o que acontece entre o aparelho bater o ponto e a batida virar registro fiscal, e o que fazer quando algo dá errado.
> O contrato técnico é `docs/SPEC-nsr-fila.md`; a arquitetura geral está em `docs/architecture/02-arquitetura.md` §5. Este guia explica; em caso de divergência, vale a SPEC e o código.

## 1. Em uma página

Quando alguém bate o ponto:

1. **O aparelho** tira a foto e manda a batida para a API do coletor (`POST /coletor/batidas`), com um número de sequência próprio do aparelho.
2. **A API** (`apps/collector-api`) pede ao `face-engine` para reconhecer o rosto e grava a batida na tabela `entradas` com `status = 'pendente'`. Só depois do `COMMIT` (a gravação definitiva) ela responde `registered` ao aparelho.
3. **A API publica um aviso na fila `punches`** ("entrada 123 está esperando"). Isso vem depois da resposta ser decidida e é opcional: se a fila estiver fora do ar, a batida continua salva e a resposta continua `registered`.
4. **O worker do rep-core** (`apps/rep-core`) pega o aviso da fila e roda uma transação no banco `arp`: atribui o NSR (número sequencial de registro), calcula o hash encadeado, grava `registros`, `evidencias`, 3 linhas no `outbox` e marca a entrada como `processado`. Tudo ou nada.
5. **Depois do `COMMIT`**, o worker publica 3 avisos na fila `post-punch` (PDF do comprovante, cálculo da jornada, QR oficial). Hoje ninguém consome essa fila (seção 10).
6. **Se algo falhar no meio do caminho**, o **resgate** (`apps/jobs`) percebe, a cada 20 s, que há entradas `pendente` esquecidas e republica os avisos. Nada se perde, porque a verdade está no banco.

```
aparelho -> API -> entradas (pendente) -> fila punches -> worker -> registros + evidencias + outbox (processado)
                                                                       |
                                                                       +-> fila post-punch -> (ninguém consome ainda)
                                  resgate (a cada 20 s) republica o que ficou pendente
```

## 2. O que é outbox e por que o banco é a fonte da verdade

**Fila** é uma lista de recados guardada num serviço à parte (aqui, o **Valkey**, um banco em memória compatível com Redis; a biblioteca que usamos é o **BullMQ**). Quem escreve o recado é o **produtor** (ou "publica"); quem lê e executa é o **consumidor** (aqui, o *worker*). Cada recado se chama **job**.

O problema: a fila é um sistema diferente do banco Postgres. Não existe transação que cubra os dois. Então pode acontecer:

- gravar no banco e a fila estar fora do ar na hora de publicar (o recado nunca existiu);
- publicar na fila e o banco dar erro (o recado fala de algo que não existe);
- o Valkey reiniciar e perder recados;
- o mesmo recado ser entregue duas vezes.

A solução se chama **outbox** (caixa de saída): o fato importante é gravado **primeiro no banco**, numa tabela com `status = 'pendente'`, na mesma transação do trabalho. A fila é só um **meio de transporte** para avisar o consumidor. Se o aviso se perder, o dado continua `pendente` no banco e alguém (o resgate) avisa de novo.

Exemplo concreto: às 08:00:00 o João bate o ponto. A API grava a entrada 123 como `pendente` e tenta publicar. O Valkey está reiniciando, a publicação falha (log `queue_publish_failed`), mas o aparelho recebe `registered`, porque a batida já está em disco. Às 08:00:30 o resgate encontra a entrada 123 `pendente` há mais de 30 s e publica o aviso. O worker processa. Ninguém precisou fazer nada.

No Genus há dois "outboxes":

| Onde | O que guarda | Quem marca como concluído |
|---|---|---|
| `entradas` (`status = 'pendente'`) | batidas ainda sem NSR | o worker do rep-core, ao final da transação |
| `outbox` (`status = 'pendente'`) | os 3 eventos pós-batida de cada registro | um consumidor futuro de `post-punch` (não existe ainda) |

## 3. O que a fila faz e o que ela NÃO garante

A fila **faz**: guarda os recados, entrega ao worker, repete a entrega se o worker falhar, espaça as repetições.

A fila **não garante**:

- **Entrega exatamente uma vez.** A garantia é **"pelo menos uma vez"** (*at-least-once*): o mesmo job pode ser entregue duas ou mais vezes (por exemplo, o worker processou, caiu antes de confirmar, e a fila entrega de novo). Por isso todo consumidor precisa ser **idempotente** (seção 8).
- **Ordem.** Com `WORKER_CONCURRENCY` maior que 1, dois jobs andam em paralelo e a ordem de término não é a de chegada. A ordem do NSR não vem da fila: vem da trava `FOR UPDATE` por estabelecimento na transação.
- **Que o trabalho foi feito.** Um recado na fila não prova nada. A prova é a linha `processado` com registro e evidência no banco.

**A garantia real contra duplicata é a UNIQUE do banco**: `UNIQUE (aparelho_id, sequencia_aparelho)` em `evidencias`, `entrada_id` UNIQUE em `evidencias` e `UNIQUE (evento, chave)` em `outbox`. O `jobId` ajuda, mas não é a garantia (seção 6).

## 4. As duas filas

Definidas em [constants.ts](packages/queue/src/constants.ts).

| Fila | Quem publica | Quem consome | Conteúdo do job |
|---|---|---|---|
| `punches` | API do coletor (após gravar a entrada) e o resgate | worker do rep-core ([punch-worker.ts](apps/rep-core/src/worker/punch-worker.ts)) | só ids: `entryId`, `tenantId`, `establishmentId` |
| `post-punch` | worker do rep-core (após o `COMMIT`) e o resgate | **ninguém hoje** | só ids: `outboxId`, `tenantId`, `establishmentId`, `nsr` |

Os payloads só carregam ids: nunca CPF, foto, nome ou dado de saúde (LGPD).

`post-punch` não tem consumidor porque os consumidores dependem de coisas que ainda não existem: gerador do PDF do comprovante, motor de jornada (PTRP), QR oficial e o `signer`. Isso está fora do escopo da rodada atual (SPEC §12) e é proposital: não criamos um consumidor "de mentira" que marcaria o outbox como `processado` sem ter feito o trabalho. Os eventos são os três de `POST_PUNCH_EVENTS`: `generate-receipt-pdf`, `recalculate-day` e `official-qr`.

## 5. A "ordem de sucesso"

A regra de ouro: **nada é confirmado antes de estar gravado, e nada é publicado antes de o `COMMIT` acontecer**.

```mermaid
sequenceDiagram
    autonumber
    participant A as Aparelho
    participant API as API do coletor
    participant DB1 as Banco arp (entradas)
    participant QP as Fila punches
    participant W as Worker rep-core
    participant DB2 as Banco arp (transação do NSR)
    participant QPP as Fila post-punch

    A->>API: POST /coletor/batidas
    API->>API: reconhece o rosto (face-engine)
    API->>DB1: INSERT entradas (pendente)
    DB1-->>API: COMMIT feito
    API->>QP: publica job (opcional; falha só gera aviso)
    API-->>A: registered
    QP->>W: entrega o job
    W->>DB2: BEGIN, trava entrada e sequência
    W->>DB2: INSERT registros, evidencias, 3x outbox, UPDATE entradas = processado
    DB2-->>W: COMMIT feito
    W->>QPP: publica 3 jobs (opcional; falha só gera aviso)
    W-->>QP: job concluído com sucesso
```

Na prática a resposta ao aparelho (passo 6 do diagrama) e o consumo pelo worker são independentes no tempo: a API não espera o worker.

As 5 invariantes (SPEC §2), em linguagem simples:

1. **Só confirma o que está gravado.** A API só diz `registered` depois do `COMMIT` da entrada. Se o `INSERT` falhar, o aparelho recebe erro 5xx, nunca `registered`. Publicar na fila vem depois e é opcional: se falhar, a resposta não muda (log `queue_publish_failed`). Ver [service.ts](apps/collector-api/src/modules/punches/service.ts).
2. **Transação única, tudo ou nada.** `processado`, `registros`, `evidencias`, `sequencias_estabelecimento` e os 3 eventos do `outbox` são uma só transação. Se qualquer parte falhar, tudo é desfeito: o NSR não é "gasto", a entrada continua `pendente` e o job tenta de novo. O job só termina com sucesso depois do `COMMIT`. Ver [assign-nsr.ts](apps/rep-core/src/nsr/assign-nsr.ts).
3. **O banco se defende sozinho.** Um trigger no banco recusa marcar uma entrada como `processado` se não houver a evidência e os 3 eventos do outbox. Por isso o `UPDATE entradas` é o **último** passo da transação. E `processado` é um estado final: não volta atrás.
4. **Só se publica o que foi confirmado.** Os jobs de `post-punch` são publicados depois do `COMMIT`. Se a publicação falhar ou estourar o prazo, nada é desfeito e o job `punches` não falha: vira log `queue_publish_failed` e o resgate publica depois. Nunca existe aviso sobre algo que não foi gravado.
5. **A invariante é verificável.** Nunca deve existir entrada `processado` sem registro, evidência e os 3 eventos. O comando `pnpm arp:verify-chain` confere (seção 12), e há teste automatizado.

A transação do NSR usa travas em ordem fixa (primeiro a linha da entrada, depois a linha de `sequencias_estabelecimento` do estabelecimento, depois os inserts), e não faz chamada de rede lá dentro. Isso evita deadlock e garante NSR sem buraco e sem repetição.

## 6. `jobId`

O **jobId** é o "número do recado" na fila. Se você tentar publicar um job com um `jobId` que já existe, o BullMQ ignora (não cria um segundo). Ver [job-ids.ts](packages/queue/src/job-ids.ts).

- `punches`: `<aparelhoId>-<sequencia>`, por exemplo `7-1042` (aparelho 7, sequência 1042).
- `post-punch`: `<evento>-<estabelecimentoId>-<nsr>`, por exemplo `official-qr-3-88`.

**Por que determinístico** (sempre o mesmo para a mesma batida): quando a API, o worker e o resgate publicam o mesmo aviso, a fila vê o mesmo `jobId` e descarta a repetição. Se o aparelho reenviar a mesma batida (mesmo aparelho, mesma sequência), cai no mesmo `jobId`.

**Por que NÃO é a garantia contra duplicata:** o `jobId` só protege enquanto o job ainda existe na fila. Se o job concluído já foi removido (`punches` remove concluídos após 24 h ou além de 10 mil), publicar de novo cria outro job. E se o Valkey perder dados, a proteção some junto. Quem garante que não nasce um segundo registro é a UNIQUE do banco e a checagem de `entradas.status` (seção 8).

**Por que o separador é `-`:** o BullMQ 6.7.8 (versão fixada) recusa `:` em `jobId` personalizado. Por isso nada de `aparelho:sequencia`.

## 7. Retry e backoff

**Retry** é tentar de novo quando o job falha. **Backoff** é esperar um pouco entre as tentativas; **exponencial** significa que a espera dobra a cada falha (começando em 1 segundo: 1 s, 2 s, 4 s, 8 s...), para não martelar um banco que já está com problema. Opções em [job-options.ts](packages/queue/src/job-options.ts).

- **Tentativas:** `QUEUE_ATTEMPTS` (padrão **5**), contando a primeira execução.
- **Erro recuperável** (conexão com o banco caiu, deadlock, falha de INSERT): a transação desfaz tudo, o worker soma 1 em `entradas.tentativas` (em comando separado, fora da transação) e relança o erro; a fila espera o backoff e tenta de novo. Na última tentativa automática, a entrada **continua `pendente`** (decisão de política A) e aparece o alerta `punch_retry_exhausted` (nível `error`). O resgate, a cada 20 segundos, refaz o job até a falha cessar.
- **Erro não recuperável** (entrada inexistente para a conta, evidência duplicada para outra entrada, sequência de outra conta, processada sem evidência): repetir não adianta. O worker marca a entrada `falhou` na hora e lança `UnrecoverableError`, que manda o job direto para o estado `failed`, sem gastar as demais tentativas. Log `punch_unrecoverable`.
- **Entrada já `falhou`**: o worker ignora com aviso (`punch_entry_failed_skipped`) e conclui o job.
- **Payload inválido**: `punch_payload_invalid`, não recuperável.
- **O que é `failed`:** é o estado de um job que esgotou as tentativas ou foi marcado como não recuperável. Também chamado de *dead letter* (fila dos mortos) em outros sistemas: o job não some, fica guardado para investigação (`removeOnFail: false`). No banco, `entradas.status = 'falhou'` é reservado a erro não recuperável; erro recuperável esgotado deixa a entrada `pendente`. Falhou **não some e não é apagado**: é um alerta para alguém olhar.
- A falha em publicar em `post-punch` **nunca** falha o job de `punches`.

## 8. Idempotência

**Idempotência** é a propriedade de "fazer duas vezes dá o mesmo resultado que fazer uma". Como a fila pode entregar o mesmo job duas vezes, o worker precisa aguentar isso. Três defesas:

1. **Entrada já `processado`:** a primeira coisa que `assignNsr` faz, depois de travar a entrada, é olhar o status. Se for `processado`, devolve o NSR que já existe (`outcome: 'already_processed'`) sem escrever nada. O worker, nesse caso, ainda tenta publicar os 3 eventos de `post-punch` (inofensivo: mesmo `jobId`), caso o job anterior tenha caído entre o `COMMIT` e a publicação.
2. **UNIQUE em `evidencias`:** `UNIQUE (aparelho_id, sequencia_aparelho)` e `entrada_id` único. Mesmo que dois workers corressem a mesma entrada ao mesmo tempo, a trava `FOR UPDATE` serializa e o banco recusaria o segundo.
3. **`outbox` com `ON CONFLICT DO NOTHING`:** `UNIQUE (evento, chave)`. Se os eventos de um registro já existirem, o insert não duplica. Se vierem menos de 3, a transação falha com `OutboxIncompleteError` (inconsistência, não recuperável, log `error`).

Também na API: se o aparelho reenviar a mesma batida (mesma sequência), a UNIQUE de `entradas` devolve o mesmo recibo (`replayed`) em vez de criar outra.

## 9. O resgate

O **resgate** ([rescue.ts](apps/jobs/src/rescue.ts), processo `apps/jobs`) é o "faxineiro": a cada `RESCUE_INTERVAL_MS` (padrão 20 000 ms) ele procura no banco:

- `entradas` com `status = 'pendente'` há mais de `RESCUE_MIN_AGE_MS` (padrão 30 000 ms) e republica em `punches`;
- `outbox` com `status = 'pendente'` há mais de `RESCUE_MIN_AGE_MS` e republica em `post-punch`.

Detalhes:

- Lê o banco com o papel `arp_reader` (somente leitura) e **nunca escreve no banco**. Quem muda `status` é o rep-core.
- Usa o **mesmo `jobId`** da publicação normal. Para cada item: se não existe job, cria; se está `waiting`, `active` ou `delayed`, não faz nada; se está `failed`, chama `retry()`; se está `completed` mas a linha segue `pendente`, remove o job antigo e cria de novo.
- Processa em lotes de 500, dos mais antigos para os mais novos.
- Varre todas as contas (é processo de infraestrutura); por isso cada job leva o `tenantId` no payload, e o rep-core volta a filtrar por ele.
- O "agora" vem do `Clock` injetado, não do relógio do SQL.
- **Por que é seguro rodar várias vezes (ou duas instâncias ao mesmo tempo):** só republica com `jobId` fixo (repetição vira no-op) e não escreve no banco. No pior caso o worker recebe um job de uma entrada já `processado` e responde `already_processed`.
- A espera mínima de 30 s existe para o resgate não competir com o fluxo normal, que costuma levar milissegundos.
- Ao final de cada rodada, o resgate confere a profundidade da `post-punch` e avisa se passar do limite (seção 10).

## 10. Por que a `post-punch` acumula jobs sem consumidor

Cada batida processada gera **3 jobs** em `post-punch` e **3 linhas** `pendente` em `outbox`. Como ainda não existem os consumidores (PDF do comprovante, jornada, QR oficial; ver seção 4), eles ficam ali. Isso é **esperado**, não é bug. Os jobs de `post-punch` são mantidos (`removeOnComplete: false`): um consumidor futuro marcará a linha do outbox como `processado` e só então o job sai.

**Quanto isso cresce:** 1000 batidas por dia são 3000 jobs por dia. Um estabelecimento de 200 pessoas, com 4 batidas por dia, gera cerca de 2400 jobs por dia.

**Limite de aviso:** `POST_PUNCH_DEPTH_WARN` (padrão 10 000). A profundidade é `waiting + delayed + active`. Quando passa, o resgate registra o log `post_punch_depth_high` (nível `warn`) e o `pnpm queue:inspect` imprime uma linha `AVISO`. Isso não bloqueia nada. O que fazer: seção 13, "fila cheia".

**Memória do Valkey e `noeviction`:** o Valkey guarda tudo em memória. A política `noeviction` (configurada em [service.compose.yml](../packages/queue/service.compose.yml), junto com AOF `everysec`, que grava em disco a cada segundo, e senha obrigatória) significa: "quando a memória encher, **recuse novas escritas** em vez de apagar jobs antigos". Isso protege contra perda silenciosa, mas tem consequência: novas publicações passam a falhar. A API **continua respondendo `registered`**, porque a publicação em `punches` é opcional e a batida já está no banco; o resgate publica quando houver espaço. Ou seja, encher o Valkey atrasa o processamento, mas não perde batida nem bloqueia o ponto.

## 11. O que acontece quando cada peça morre

Adaptado de `02-arquitetura.md` §5.2 ao que existe hoje.

| Peça | O que o aparelho vê | O que se perde | Como se recupera |
|---|---|---|---|
| **API do coletor** | Erro de rede ou 5xx; reenvia a batida | Nada. Se caiu antes do `COMMIT`, a entrada não existe e o aparelho reenvia. Se caiu depois, o reenvio devolve o mesmo recibo (UNIQUE aparelho + sequência) | Reiniciar a API. Entradas gravadas e não publicadas: o resgate publica |
| **Postgres (`arp`)** | Erro 5xx na API (não grava, não responde `registered`) | Nada confirmado. O aparelho segue guardando e reenvia (outbox do aparelho) | Voltar o banco. O worker repete os jobs com backoff; se esgotar as tentativas automáticas, a entrada segue `pendente` e o resgate continua tentando (seção 13). Restauração de disco: `02-arquitetura.md` §8 |
| **Valkey (fila)** | `registered` normalmente (publicação é opcional); a API loga `queue_publish_failed` | Possivelmente os jobs na memória (AOF `everysec` limita a perda a cerca de 1 s) | Voltar o Valkey. O resgate republica tudo o que está `pendente` no banco |
| **Worker do rep-core** | `registered` normalmente; a entrada fica `pendente` | Nada. Uma transação em andamento sofre ROLLBACK; o NSR não é gasto | Reiniciar o worker (SIGTERM fecha de forma limpa). Os jobs na fila continuam; o resgate republica o que faltar |
| **Resgate (apps/jobs)** | Nada (não está no caminho da batida) | Nada. Só atrasa o conserto de publicações que falharam | Reiniciar. É seguro rodar de novo a qualquer momento |
| **face-engine** | Resposta `fallback_required` (com o motivo): a API não grava `entradas` e o aparelho decide o que fazer | Nada na fila; é antes dela. [A CONFIRMAR] o comportamento exato do aparelho (o app do coletor ainda não existe neste repositório) | Voltar a engine. Ver `docs/face-engine.md` |

Quando o rep-core cai no meio da transação: rollback; a entrada continua `pendente`; reprocessa. Quando o Valkey perde um aviso: o evento segue `pendente` no banco; o resgate republica.

## 12. Como inspecionar

### Filas: `pnpm queue:inspect`

Código em [queue-inspect.mjs](scripts/queue-inspect.mjs). Lê `VALKEY_URL` e `VALKEY_PASSWORD` do ambiente ou de `apps/collector-api/.env.dev` (a senha nunca é impressa) e mostra, por fila, a contagem de jobs por estado, mais a profundidade da `post-punch`.

Exemplo de saída (números ilustrativos):

```
Valkey respondeu em localhost:6379.

Fila punches:
  waiting          0
  active           0
  delayed          0
  completed        12
  failed           0
  ...

Fila post-punch:
  waiting          36
  ...

Profundidade da post-punch (waiting + delayed + active): 36 (aviso acima de 10000)
```

Códigos de saída: `0` ok (o aviso de profundidade também sai com 0), `2` configuração inválida, `1` o Valkey não respondeu.

Estados em linguagem simples: `waiting` (esperando um worker), `active` (sendo executado agora), `delayed` (esperando o backoff acabar), `completed` (concluído), `failed` (esgotou tentativas ou não recuperável).

### Cadeia fiscal: `pnpm arp:verify-chain`

```
pnpm arp:verify-chain -- --establishment <id> --tenant <id>
```

Código em [run-verify-chain.ts](apps/rep-core/src/cli/run-verify-chain.ts). Precisa de `ARP_READER_DATABASE_URL` (somente leitura) no ambiente ou em `apps/collector-api/.env.dev`. Confere: NSR contíguo a partir de 1, `hash_anterior` igual ao hash da linha anterior, hash recalculado igual ao gravado, precisão de tempo, e a invariante "entrada `processado` tem registro, evidência e 3 eventos". Não imprime CPF nem URL de conexão.

Saída de sucesso (exit 0):

```
Conta 1, estabelecimento 3
Linhas verificadas: 120
Último NSR: 120
Último hash: <64 caracteres hex>
Erros de cadeia: 0
Avisos: 0
Problemas de invariante (entradas processadas): 0
Resultado: ÍNTEGRO
```

Saída de falha (exit 1), por exemplo com um NSR faltando:

```
Erros de cadeia: 1
  ERRO: NSR não contíguo: esperado 57, encontrado 58
Avisos: 0
Problemas de invariante (entradas processadas): 0
Resultado: PROBLEMAS ENCONTRADOS
```

Códigos de saída: `0` íntegro, `1` problema encontrado, `2` erro de uso ou de configuração. **Erro** (corrupção) faz o comando sair com 1. **Aviso** (por exemplo `gravado_em` que retrocede no tempo) é uma anomalia: aparece na lista mas não muda o resultado.

### Ver um job `failed`

- **A contagem** de jobs `failed` aparece no `pnpm queue:inspect`.
- **Qual entrada falhou e por quê:** procure nos logs do rep-core os eventos `punch_retry_exhausted` (tentativas automáticas esgotadas: a entrada segue pendente) ou `punch_unrecoverable` (erro não recuperável: a entrada vira falhou). Eles trazem `entryId`, `jobId` e só o nome e o código do erro (nunca mensagem de driver, host ou dado pessoal).
- **No banco:** uma consulta de leitura por `entradas` com `status = 'falhou'` mostra as entradas afetadas e `tentativas`. Faça com o papel `arp_reader`, nunca com o papel que escreve.
- Um comando para listar o conteúdo e o motivo de cada job `failed` na fila **não está implementado ainda**; hoje a investigação é por logs e pela tabela `entradas`.

## 13. Roteiro "o que fazer se"

### Fila cheia (`post-punch` acima do limite)

1. Rode `pnpm queue:inspect` e confira a profundidade da `post-punch`.
2. Lembre que, sem consumidor, é esperado (seção 10). Confirme se os consumidores (PDF, jornada, QR) já deveriam existir; se sim, o problema é eles estarem parados.
3. Veja a memória do Valkey. Se estiver perto do limite, a política `noeviction` fará as publicações falharem; planeje aumentar a memória ou esvaziar os jobs de `post-punch` já processados (só depois de existir consumidor que marque o outbox).
4. **Não apague jobs de `post-punch` à mão** enquanto as linhas do `outbox` estiverem `pendente`: o resgate os recriaria, e apagar pode esconder trabalho pendente. [A CONFIRMAR] procedimento de limpeza assim que existirem consumidores.
5. Se precisar silenciar o aviso temporariamente, suba `POST_PUNCH_DEPTH_WARN` no processo `apps/jobs`. Isso só muda o alerta, não o problema.

### Job `failed` em `punches`

1. Rode `pnpm queue:inspect` para confirmar a contagem de `failed`.
2. Procure nos logs do rep-core `punch_retry_exhausted` ou `punch_unrecoverable` e anote o `entryId`.
3. Descubra a causa. Erro de conexão ou deadlock: normalmente já foi resolvido; confirme que o banco está saudável. `EntryNotFoundError`, evidência duplicada ou sequência de outra conta: é um defeito de dado, não de infraestrutura; investigue a entrada.
4. Se o log é `punch_retry_exhausted`, a entrada segue `pendente` e o resgate continua tentando sozinho: nada a fazer enquanto a causa for de infraestrutura. Se o log é `punch_unrecoverable`, a entrada ficou `falhou` e **não é reprocessada sozinha**. Reprocessar uma entrada `falhou` **não está implementado ainda** (não há comando). Decisão e mudança manual de status exigem aprovação, porque o sistema nunca bloqueia nem apaga uma marcação (Portaria 671).
5. Confira que nenhuma outra entrada do mesmo aparelho ficou presa e rode `pnpm arp:verify-chain` para garantir que a cadeia está íntegra.

### Cadeia quebrada (`verify-chain` com exit 1)

1. **Não altere `registros` nem `evidencias`.** São só-INSERT por trigger e por norma.
2. Leia as linhas `ERRO:` e `PROBLEMA:` da saída. Anote o NSR e a entrada citados.
3. Descubra se é causa de infraestrutura (restauração de backup incompleta, banco restaurado de um ponto antigo) ou de código (mudança da fórmula do hash sem nova `HASH_FORMAT_VERSION`).
4. Preserve evidência: não reinicie nem "conserte" nada antes de salvar a saída do comando, os logs do rep-core e o ponto do backup.
5. Escale ao responsável técnico. Cadeia quebrada é incidente fiscal; o tratamento e a comunicação ao RH são decisão humana. [A CONFIRMAR] procedimento formal.

### Valkey fora do ar

1. A API continua registrando batidas e respondendo `registered`. Procure o log `queue_connection_error` ou `queue_publish_failed`.
2. Suba o Valkey de volta (`docker compose up -d valkey`). Com AOF `everysec`, ele reaplica o que gravou.
3. Aguarde até 30 s + 20 s: o resgate republica as entradas `pendente` para `punches`.
4. Rode `pnpm queue:inspect`: a profundidade e os `waiting` devem subir e depois cair em `punches` conforme o worker processa.
5. Se algo ainda estiver `pendente` depois de alguns minutos, vá para "resgate não republica".

### Entrada `falhou`

1. Pelo `entryId` nos logs (`punch_retry_exhausted` ou `punch_unrecoverable`), localize a entrada. Consulta de leitura em `entradas` com `status = 'falhou'`.
2. Entenda a causa (ver "Job `failed` em `punches`").
3. Lembre: `falhou` é terminal para o fluxo automático. O worker ignora a entrada (`punch_entry_failed_skipped`) e o resgate só olha `pendente`.
4. Voltar uma entrada para `pendente` **não está implementado ainda**; só se faça com decisão explícita, registrada.
5. Avise o RH se a batida de um colaborador ficar sem registro fiscal: o aparelho mostrou `registered`, mas não existe NSR.

### Resgate não republica

1. Confirme que o processo `apps/jobs` está rodando e veja o log `rescue_round` (a cada 20 s, com `entradas_reenfileiradas`, `outbox_reenfileirados`, `ignorados`, `lotes`).
2. Sem a linha `rescue_round`: o processo não está rodando ou não alcança o banco ou o Valkey. Veja o log de início e as variáveis `ARP_READER_DATABASE_URL`, `VALKEY_URL` e `VALKEY_PASSWORD`.
3. Com `rescue_round` e `ignorados` alto: o job já existe na fila (`waiting`, `active` ou `delayed`); o problema é o worker do rep-core, que não está consumindo. Veja se ele está de pé e `pnpm queue:inspect`.
4. A entrada precisa estar `pendente` há mais de `RESCUE_MIN_AGE_MS` (30 s): entradas mais novas são ignoradas de propósito.
5. Avisos `rescue_invalid_entry`, `rescue_invalid_outbox` (dado fora do padrão) ou `rescue_batch_cap_reached` (limite de lotes do ciclo; o resto fica para a próxima rodada) explicam itens que não foram republicados.

## 14. Glossário curto

- **AOF (`appendonly`)**: modo do Valkey que grava cada comando em disco; com `everysec`, a cada segundo.
- **Backoff**: espera entre tentativas; exponencial = dobra a cada falha.
- **BullMQ**: biblioteca Node.js de filas, que guarda os jobs no Valkey.
- **COMMIT / ROLLBACK**: confirmar definitivamente / desfazer tudo de uma transação.
- **Consumidor (worker)**: processo que pega jobs da fila e executa.
- **Dead letter / `failed`**: jobs que esgotaram as tentativas ficam guardados, sem sumir. Na fila, estado `failed`; no banco, `entradas.status = 'falhou'`.
- **Entrada (`entradas`)**: batida recebida pela API, ainda sem NSR (`pendente`), depois `processado` ou `falhou`.
- **Evidência (`evidencias`)**: dados da identificação (aparelho, sequência, notas do reconhecimento) ligados ao registro; só-INSERT.
- **Hash encadeado**: impressão digital de cada registro que inclui o hash do anterior; alterar um registro quebra todos os seguintes.
- **Idempotência**: repetir a operação não muda o resultado.
- **Job**: um recado na fila.
- **jobId**: identificador do job; o mesmo `jobId` não cria dois jobs.
- **NSR**: número sequencial de registro por estabelecimento, sem buraco nem repetição.
- **noeviction**: com memória cheia, o Valkey recusa escritas em vez de apagar dados.
- **Outbox**: tabela no banco com o que ainda precisa ser avisado/processado; é a fonte da verdade.
- **Profundidade**: `waiting + delayed + active` de uma fila.
- **Publicar**: colocar um job na fila.
- **Registro (`registros`)**: o registro fiscal imutável (NSR, hash, tipo 7); só-INSERT.
- **Resgate**: processo que republica o que ficou `pendente` no banco.
- **Retry**: nova tentativa depois de uma falha.
- **UNIQUE**: regra do banco que impede duas linhas iguais; é a garantia real contra duplicata.
- **Valkey**: banco em memória, compatível com Redis, que hospeda as filas.
