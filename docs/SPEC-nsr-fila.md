# NSR, hash encadeado e fila de batidas: especificação

> Escopo: transformar a batida de `arp.entradas` (`pendente`) em registro fiscal imutável (`registros`), com NSR sem buraco nem repetição e hash encadeado, entregue por fila BullMQ sobre Valkey. O outbox no Postgres é a fonte da verdade; a fila só transporta (`02-arquitetura.md` §5).
> Este documento é o contrato. Quem implementa segue o que está aqui; divergência exige mudança neste arquivo no mesmo commit.

## 1. Decisões

| Tema | Decisão |
|---|---|
| Entrega | Pelo menos uma vez. A garantia real contra duplicata é a UNIQUE do banco, não o `jobId` |
| Dono do NSR | Só o `rep-core`, em transação com `FOR UPDATE` por estabelecimento |
| Fila | BullMQ `6.7.8` (exata) sobre Valkey `valkey/valkey:9.2.0-alpine` (tag exata, nunca `latest`), `maxmemory-policy noeviction`, AOF `everysec` |
| Filas | `punches` (API e resgate publicam; rep-core consome) e `post-punch` (rep-core e resgate publicam; sem consumidor nesta rodada) |
| `jobId` | `punches`: `<aparelhoId>-<sequencia>`. `post-punch`: `<evento>-<estabelecimentoId>-<nsr>`. Somente `-` como separador (BullMQ rejeita `:` em jobId customizado; confirmar no código da versão fixada) |
| Papéis | `arp_collector` (API), `arp_core` (rep-core), `arp_reader` (resgate e verificação), `arp_owner` (só migrations) |
| Imutabilidade | `registros` e `evidencias`: só INSERT. Trigger recusa UPDATE, DELETE e TRUNCATE para qualquer papel, inclusive o dono |
| Hash | SHA-256. Fórmula provisória, isolada em `apps/rep-core/src/nsr/hash.ts` com `HASH_FORMAT_VERSION = 1` (`[A CONFIRMAR]`, ver §4) |
| Genesis | `hash_anterior` do primeiro registro de um estabelecimento = 32 bytes zero (`[A CONFIRMAR]`) |
| Precisão de tempo | Tudo que entra no hash tem precisão de milissegundos. O rep-core trunca `marcado_em` com `date_trunc('milliseconds', ...)` antes de hashear. O verificador lê a coluna como texto ISO com 3 casas; microssegundos persistidos fora disso são tratados como **corrupção**, nunca truncados em silêncio |
| Campos do tipo 7 sem fonte em `entradas` | `tipo_coletor = '01'` (app mobile) e `eh_offline = false` por enquanto, constantes do rep-core (`[A CONFIRMAR]`: a API do coletor ainda não recebe lotes offline) |
| Idempotência do worker | `jobId` + UNIQUE `(aparelho_id, sequencia_aparelho)` em `evidencias` + checagem de `entradas.status` |

## 2. Ordem de sucesso (invariantes de confirmação; viram teste)

1. **API:** `registered` só depois do `COMMIT` do INSERT em `entradas`. Falha do INSERT → HTTP 5xx `{ error, code }`, nunca `registered`. Publicar em `punches` vem depois e é opcional: a falha não muda a resposta (log `warn` `queue_publish_failed`).
2. **Worker:** `entradas.status = 'processado'`, `registros`, `evidencias`, `sequencias_estabelecimento` e os **3 eventos de `outbox`** são UMA transação. Qualquer falha → ROLLBACK; o NSR não é consumido; a entrada segue `pendente`; o job `punches` falha e sofre retry. O job só termina com sucesso depois do `COMMIT`.
3. **Banco defende:** trigger `BEFORE UPDATE` em `entradas` recusa `→ processado` sem `evidencias` da entrada **e** sem os 3 eventos de `outbox` (`generate-receipt-pdf`, `recalculate-day`, `official-qr`) com a `chave` do registro. Por isso o `UPDATE entradas` é o ÚLTIMO passo. `processado` é terminal.
4. **Publicação em `post-punch`:** só depois do `COMMIT`. Falha ou timeout não desfaz nada e não falha o job: log `warn` `queue_publish_failed`; o resgate publica depois. Nunca se publica evento cujo `COMMIT` não aconteceu.
5. **Invariante consultável:** nunca existe `entrada` `processado` sem registro, evidência e os 3 eventos de outbox. Teste e `pnpm arp:verify-chain` conferem.

## 3. Migration `0002` (SQL à mão, nunca editar a `0001`)

- `sequencias_estabelecimento(estabelecimento_id PK, conta_id, ultimo_nsr BIGINT DEFAULT 0, ultimo_hash BYTEA, atualizado_em)`.
- `registros` (só INSERT): PK `(estabelecimento_id, nsr)`; `conta_id`; `nsr BIGINT`; `tipo TEXT CHECK IN ('2','4','5','6','7')`; `cpf CHAR(11)` obrigatório quando `tipo = '7'`; `marcado_em`, `gravado_em` (`TIMESTAMPTZ`); `tipo_coletor CHAR(2) CHECK IN ('01'..'05')`; `eh_offline BOOLEAN`; `hash BYTEA CHECK octet_length = 32`; `hash_anterior BYTEA CHECK octet_length = 32`; `versao_formato_hash SMALLINT`; `criado_em`.
- `evidencias` (só INSERT): `(estabelecimento_id, nsr)` FK para `registros`; `conta_id`; `entrada_id` UNIQUE FK para `entradas(id)`; `aparelho_id`, `sequencia_aparelho`; `UNIQUE (aparelho_id, sequencia_aparelho)`; `colaborador_id`; `metodo_identificacao`; `nota_reconhecimento`; `nota_vivacidade`; `eh_hora_divergente`; `criado_em`.
- `outbox`: `id BIGINT identity`, `conta_id`, `id_publico UUID`, `estabelecimento_id`, `evento` (`generate-receipt-pdf | recalculate-day | official-qr`), `chave` (`<estabelecimento_id>-<nsr>`), `payload JSONB` (só ids: `{ establishmentId, nsr }`), `status` (`pendente | processado | falhou`), `tentativas`, `processado_em`, `criado_em`; `UNIQUE (evento, chave)`; índice parcial em `pendente` por `criado_em`.
- Triggers: (a) `recusar_alteracao_fiscal()` em `registros` e `evidencias`, BEFORE UPDATE OR DELETE e BEFORE TRUNCATE; (b) `exigir_registro_para_processar()` BEFORE UPDATE em `entradas`. O (b) recusa mudança de qualquer coluna além de `status`, `tentativas`, `processado_em`; recusa sair de `processado`; exige evidência e os 3 eventos ao entrar em `processado`. Na função, comentar que uma migration que acrescentar evento ao tipo 7 precisa atualizá-la.
- Grants (com `REVOKE ALL ... FROM PUBLIC` antes):
  - `arp_core`: SELECT, INSERT em `registros`, `evidencias`, `outbox`; SELECT, INSERT, UPDATE em `sequencias_estabelecimento`; SELECT em `entradas`; `UPDATE (status, tentativas, processado_em)` em `entradas`. Sem DELETE, sem TRUNCATE.
  - `arp_reader`: SELECT em todas as tabelas.
  - `arp_collector`: inalterado.

## 4. Hash (função pura, `apps/rep-core/src/nsr/hash.ts`)

Entrada canônica, UTF-8, campos separados por `|`, nesta ordem:
`nsr | tipo | marcado_em | cpf | gravado_em | tipo_coletor | eh_offline | hash_anterior`
- `marcado_em`, `gravado_em`: ISO 8601 UTC com 3 casas (`Date.prototype.toISOString`).
- `eh_offline`: `true` / `false`. `hash_anterior`: hex minúsculo de 64 caracteres.
- `HASH_FORMAT_VERSION = 1` gravado em `versao_formato_hash`. Trocar a fórmula = nova versão; o passado não é reinterpretado.
- `[A CONFIRMAR]`: leiaute do registro tipo 7 do AFD (Portaria 671), fórmula exata do hash e fuso. O AFD usa hora local com deslocamento, o que exige o fuso do estabelecimento, que vive no banco `app`.

`verifyChain(rows, genesis)`: NSR contíguo a partir de 1; `hash_anterior` igual ao hash da linha anterior; hash recalculado igual ao gravado; precisão de tempo fora de milissegundos = corrupção. **Corrupção** = erro (exit ≠ 0). **Anomalia** (`gravado_em` que retrocede) = aviso, não erro.

## 5. Transação do NSR (`apps/rep-core/src/nsr/assign-nsr.ts`)

Ordem de travas fixa: `entradas` (linha da entrada) → `sequencias_estabelecimento` → inserts. Um único `BEGIN ... COMMIT`, sem I/O de rede dentro.

```ts
export type AssignNsrOutcome = 'created' | 'already_processed';

export interface OutboxEventRef {
  outboxId: number;          // BIGINT convertido com Number.isSafeInteger
  evento: 'generate-receipt-pdf' | 'recalculate-day' | 'official-qr';
  chave: string;             // `${establishmentId}-${nsr}`
}

export interface AssignNsrResult {
  outcome: AssignNsrOutcome;
  tenantId: number;
  establishmentId: number;
  nsr: number;
  outboxEvents: OutboxEventRef[]; // sempre 3 itens após o COMMIT
  timings: { lockWaitMs: number; txMs: number };
}

export function assignNsr(pool: Pool, clock: Clock, input: { tenantId: number; entryId: number }): Promise<AssignNsrResult>;
```

Erros: `EntryNotFoundError` (não recuperável), `EntryFailedError` (`falhou`, ignorar com aviso), `OutboxIncompleteError` (inconsistência, não recuperável, log `error`). Erros de conexão, deadlock e INSERT são recuperáveis (relança).

## 6. Filas (`packages/queue`, `@genus/queue`)

```ts
export const PUNCHES_QUEUE = 'punches';
export const POST_PUNCH_QUEUE = 'post-punch';
export const VALKEY_IMAGE = 'valkey/valkey:9.2.0-alpine'; // usado no compose e nos testes (Testcontainers)
export const POST_PUNCH_EVENTS = ['generate-receipt-pdf', 'recalculate-day', 'official-qr'] as const;

export function punchJobId(deviceId: number, deviceSequence: number): string;      // `${deviceId}-${deviceSequence}`
export function postPunchJobId(evento: string, establishmentId: number, nsr: number): string; // `${evento}-${establishmentId}-${nsr}`

// Payloads: só IDs. Números verificados com Number.isSafeInteger.
export const punchPayloadSchema: z.ZodObject<{ entryId; tenantId; establishmentId }>;
export const postPunchPayloadSchema: z.ZodObject<{ outboxId; tenantId; establishmentId; nsr }>;

// Opções padrão
export const DEFAULT_JOB_OPTIONS: { attempts: number /* QUEUE_ATTEMPTS, padrão 5 */; backoff: { type: 'exponential'; delay: number }; removeOnFail: false };
```

- Conexão **produtor** (API, worker ao publicar, resgate): `enableOfflineQueue: false`, timeout curto (`QUEUE_PUBLISH_TIMEOUT_MS`, padrão 250). Sem isso, Valkey fora faz `add()` pendurar.
- Conexão **worker**: `maxRetriesPerRequest: null`.
- `removeOnFail: false` em ambas as filas. `removeOnComplete` de `post-punch` longo ou `false` (um consumidor futuro marca o outbox e só depois o job sai).
- Versão do `ioredis`: última 5.x exata (BullMQ 6 declara peer `>=5`). Confirmar compatibilidade na prática.

Interface compartilhada, em `packages/shared/src/interfaces.ts`:

```ts
export interface PunchQueueEntry {
  entryId: number; tenantId: number; establishmentId: number;
  deviceId: number; deviceSequence: number; // só para montar o jobId
}
export interface QueuePublisher {
  publishPunch(entry: PunchQueueEntry): Promise<void>; // lança em falha; quem chama decide o que fazer
  ping(): Promise<boolean>;                            // para /health/ready
}
```

## 7. Worker do rep-core (`apps/rep-core`, sem HTTP)

Consome `punches`: (1) `assignNsr`; (2) com o `COMMIT` feito, publica os 3 eventos em `post-punch` (tolerante a falha: `warn`); (3) só então retorna sucesso. Redelivery (`already_processed`): também tenta publicar os eventos daquela entrada (idempotente pelo `jobId`). Concorrência `WORKER_CONCURRENCY` (padrão 4); o `Pool` precisa de no mínimo esse número de conexões + folga. Recuperável: `UPDATE entradas SET tentativas = tentativas + 1` em statement separado, depois relança. Não recuperável: `UnrecoverableError`, marca `falhou`. Esgotadas as tentativas: `status = 'falhou'`, log `error`. SIGTERM/SIGINT: fecha o worker e o pool.

## 8. Resgate (`apps/jobs`)

Com `arp_reader` (lê entre contas: processo de infraestrutura; carrega `conta_id` no payload do job; documentado). A cada `RESCUE_INTERVAL_MS` (padrão 20000), lotes de 500, mais antigos primeiro, "agora" pelo `Clock`. Itens pendentes há mais de `RESCUE_MIN_AGE_MS` (padrão 30000): `entradas` → `punches`; `outbox` → `post-punch`. Mesmo `jobId`: inexistente → `add`; `waiting/active/delayed` → nada; `failed` → `retry()`; `completed` com linha ainda `pendente` → `remove()` e `add`. Nunca escreve no banco. `warn` se a profundidade de `post-punch` passar de `POST_PUNCH_DEPTH_WARN` (padrão 10000).

## 9. Variáveis de ambiente

| Processo | Variáveis |
|---|---|
| collector-api | `VALKEY_URL`, `VALKEY_PASSWORD` (obrigatória fora de dev), `QUEUE_PUBLISH_TIMEOUT_MS` (250), `QUEUE_ATTEMPTS` (5) |
| rep-core | `ARP_CORE_DATABASE_URL`, `VALKEY_URL`, `VALKEY_PASSWORD`, `WORKER_CONCURRENCY` (4), `QUEUE_ATTEMPTS` (5) |
| jobs | `ARP_READER_DATABASE_URL`, `VALKEY_URL`, `VALKEY_PASSWORD`, `RESCUE_INTERVAL_MS` (20000), `RESCUE_MIN_AGE_MS` (30000), `POST_PUNCH_DEPTH_WARN` (10000) |

URLs de conexão e senhas nunca aparecem em log.

## 10. Helpers de teste (contrato)

`db/arp/src/testing.ts` → `startArpTestDatabase()` retorna `{ ownerUrl, collectorUrl, coreUrl, readerUrl, stop }`. Cria os papéis `arp_core` e `arp_reader` com as mesmas permissões do init.

## 11. Mitigações da fila sem consumidor

Sem consumidor de `post-punch`, cada batida gera 3 jobs `waiting` e 3 linhas `pendente` no outbox. Esperado até os consumidores existirem. Não criar consumidor falso que marque `processado`. Mitigações: `pnpm queue:inspect` mostra profundidade por fila; resgate emite `warn` acima de `POST_PUNCH_DEPTH_WARN`; com `noeviction`, o Valkey recusa escritas ao encher a memória (documentado em `docs/fila-batidas.md`).

## 12. Fora de escopo

Consumidores de `post-punch` (PDF, jornada, QR), signer, app mobile, nginx, mTLS, lotes offline, modo PIN, portal, banco `app`, Drizzle, `../visage`, alterações no `services/face-engine`. O contrato HTTP do coletor não muda.
