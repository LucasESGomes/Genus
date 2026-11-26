# Apuração automática e banco de horas: plano e orquestração (25/11/2026)

## 1. Diagnóstico (lido no código; testes não foram rodados)

| Peça | Situação |
|---|---|
| Escalas: CRUD e vínculo com vigência | **Pronto** (`modules/schedules`), e o front já usa a API real. Sem endpoint: troca de turno (`trocas_turno` só é lida) e feriados |
| Cálculo do dia (`computeDay`) e recálculo por colaborador | **Pronto** (`modules/timesheets`). Ajuste e afastamento já recalculam |
| `parametros_legais` | **Sem carga fora dos testes** (só `seedLegalParameters` em `test/support`). Em banco novo, o recálculo falha |
| Apuração automática | **Falta.** O rep-core publica `recalculate-day` em `post-punch` e ninguém consome |
| Falta (dia sem batida) | **Falta.** Nada calcula o dia se ninguém pedir |
| Banco de horas | Só regras puras (`rules/ledger.ts`), tabelas e `GET /me/time-bank`. **Nada grava lançamento** |
| Telas `/rh/apuracao` e `/rh/banco-horas` | Em mock: faltam `GET /portal/timesheets`, o recálculo do dia e os 2 GETs do banco |

## 2. Decisões

### 2.1 Gatilho: fila `day-recalculation`
O rep-core **já publica** `recalculate-day` depois do COMMIT, mas na `post-punch`, junto com PDF e QR, que não têm consumidor. Um worker BullMQ recebe tudo o que está na fila dele, então o evento ganha **fila própria** no mesmo Valkey. Muda só o destino: mesmo payload (só ids) e mesmo `jobId`.

```
rep-core ── recalculate-day ──▶ day-recalculation ──▶ consumidor (processo da api) ──▶ apuração ──▶ banco de horas
jobs (resgate) ── republica o que se perdeu ──▲
```

- **`packages/queue`:** `DAY_RECALCULATION_QUEUE`, factory com `removeOnComplete: { age: 172800 }` (48 h) e roteamento por evento num só lugar.
- **rep-core:** o publicador escolhe a fila pelo evento. A falha continua só em `warn`.
- **Consumidor:** `Worker` iniciado pela api quando há `VALKEY_URL`. Lê o registro pela chave (`conta_id`, `estabelecimento_id`, `nsr`) com `arp_reader`, acha o colaborador pelo CPF e recalcula `d-1`, `d`, `d+1` (até hoje), um dia por vez. Período fechado, CPF sem cadastro ou sem escala: conclui com log sem dado pessoal. Erro de banco: lança, e o BullMQ tenta de novo.
- **Resgate:** o outbox não é marcado `processado` (só o rep-core escreve no `arp`, e hoje não tem UPDATE no `outbox`). Por isso, para `recalculate-day`: consulta própria, limitada a linhas entre 30 s e 1 h de idade; job inexistente → `add`; `failed` → `retry`; `completed` → **não faz nada** (hoje removeria e republicaria sem parar). O job concluído, guardado por 48 h, é a marca de processado.
- **Limites:** job que falha por mais de 1 h fica em `failed` (log; recálculo manual). Jobs `recalculate-day` antigos parados na `post-punch` não são migrados: recalcular o histórico pelo endpoint.
- Deploy: a api passa a **precisar** de `VALKEY_URL` e `VALKEY_PASSWORD` no Easypanel.

### 2.2 Dia aberto x dia encerrado
O dia encerra no fim da janela (meia-noite local, ou saída prevista + 4 h se vira o dia; é o `endOf` do service).
- **Aberto:** grava marcações e minutos, mas sem `batidas_impares`, `batida_faltando`, `intervalo_nao_cumprido`, com falta e atraso zerados, e **sem lançar no banco**.
- **Encerrado:** cálculo completo e lançamento.
- **Job agendado `close-days`** (`upsertJobScheduler` na mesma fila, de hora em hora): falta e encerramento de dia não geram batida. Para os últimos 3 dias, recalcula colaborador com escala vigente cujo dia não existe ou foi calculado antes de encerrar.

### 2.3 Banco de horas
Um único ponto de lançamento, dentro de `recalculateIn` (vale para automático, manual, ajuste e afastamento):

```ts
export interface DayPostingHook {
  apply(tx: Executor, emp: EmployeeRecord, day: { dailyTimesheetId: number; date: CivilDate; result: DayResult; isClosed: boolean }): Promise<void>;
}
```

- Só lança se houver regra em `regras_banco_horas` na data (a do colaborador vence a do estabelecimento).
- **Alvo do dia:** crédito = `overtime50` + `overtime100` ponderado (feriado: `peso_feriado`; domingo: `peso_domingo`; outra folga: 1,00). Feriado com `pagar_100` não entra. Débito = `shortfallMinutes` em dia `normal`. Dia inconsistente, férias ou afastamento: alvo 0.
- **Ledger só INSERT:** grava a diferença entre o alvo e a soma dos lançamentos daquele `apuracao_dia_id` (positivo `credito`, negativo `debito`). Crédito usa `creditDueDate`.
- Antes do FIFO, `openCredits` soma por `apuracao_dia_id`, para um estorno não consumir o crédito de outro dia.
- `pg_advisory_xact_lock` por colaborador no início de `recalculateIn` (evita lançamento em dobro).
- `criado_por` passa a aceitar NULL (NULL = sistema).
- "A vencer em 30 dias" vem de `creditsExpiringWithin` (a view soma créditos brutos).

### 2.4 [A CONFIRMAR] (o plano segue o padrão abaixo)
1. Falta integral **não** debita o banco (fica em `minutos_falta` para a folha). Só atraso e saída antecipada debitam.
2. Carga de `parametros_legais`: valores de `test/support/rh-legal-fixtures.ts`. `banco_saldo_negativo_max_min = 600` é valor de teste, não é lei: definir.
3. Pesos de domingo e feriado e o tratamento de folga fora do domingo.

## 3. Contratos HTTP (valem para back e front)

Sob `/portal`, `camelCase`, envelope `{ data }`, escopo por conta e estabelecimento (fora do escopo: 404). Os tipos `DayRow`, `DayRowQuery`, `DayRowPage`, `TimeBankBalanceRow` e `TimeBank` são os que já estão em `apps/portal/src/lib/api/contracts.ts`.

| Rota | Papéis | Entrada | Resposta |
|---|---|---|---|
| `GET /timesheets` | rh, admin, gestor (se ligado) | `date`, `establishmentId`, `departmentId?`, `status?` (`calculada`, `inconsistente`, `falta`), `q?`, `page`, `pageSize` | `DayRowPage` = `{ data: DayRow[], meta, counts: { todos, inconsistente, falta, calculada } }` |
| `POST /timesheets/recalculate` | rh | `{ establishmentId, date }` | `{ data: { recalculated: number, skipped: [{ employeeId, reason: 'sem_escala' \| 'periodo_fechado' }] } }` |
| `GET /time-bank` | rh, admin, gestor (se ligado) | `establishmentId`, `q?`, `page`, `pageSize` | `{ data: TimeBankBalanceRow[], meta }` |
| `GET /employees/:id/time-bank` | rh, admin, gestor (se ligado) | — | `{ data: TimeBank }` |
| `GET /establishments/:id/time-bank-policy` | rh, admin | — | `{ data: TimeBankPolicy \| null }` (a vigente hoje ou a próxima) |
| `PUT /establishments/:id/time-bank-policy` | rh | `{ modality, sundayWeight, holidayWeight, validFrom }` | `{ data: TimeBankPolicy }` |

`TimeBankPolicy = { id, establishmentId, modality: 'individual_6m' | 'coletivo_12m', sundayWeight: string, holidayWeight: string, validFrom, validTo: string | null }`. Pesos são texto com 2 casas (`"1.00"` a `"9.99"`, mínimo 1). O `PUT` com `validFrom` posterior encerra a vigência anterior no dia anterior; com o mesmo `validFrom`, atualiza; anterior à vigente: 409 `BANCO_REGRA_VIGENCIA`.

## 4. Execução: sessão principal + 3 agentes

### Fase 0: sessão principal (~20 min), antes dos agentes
1. Migration `0018` (`drizzle-kit generate`): `criado_por` anulável; ajustar o schema Drizzle.
2. Migration `0019` custom: carga de `parametros_legais` (jornada, noturno, semana, banco, férias), com `base_legal`. Conferir que não colide com `param_sem_sobreposicao`.
3. Criar `modules/time-bank/posting-hook.ts` com a interface acima.

### Fase 1: agentes em paralelo (~75 a 90 min)
Arquivos separados; nenhum agente faz commit.

**Agente A, fila e apuração automática**
- Pode tocar: `packages/queue/**`, `apps/rep-core/**` (só publicação), `apps/jobs/**`, e em `apps/api`: `arp/punch-reader.ts`, `modules/timesheets/**`, `server.ts`, `container.ts`, `config/env.ts`, `service.compose.yml`, `test/timesheet-auto.test.ts`.
- Fazer: §2.1 e §2.2; lock e chamada do `DayPostingHook` (injetado, opcional); `GET /portal/timesheets` e `POST /portal/timesheets/recalculate` (contratos `DayRowPage` em `apps/portal/src/lib/api/contracts.ts` e `docs/portal-endpoints-pendentes.md` §2; escopo por conta e estabelecimento). Não alterar a transação do NSR.
- Pronto quando: `recalculate-day` cai na fila nova e vira apuração; job repetido não duplica; resgate recupera publicação perdida e ignora job concluído; falta aparece pelo `close-days`; período fechado não deixa o job em retry; testes de rep-core e jobs passam.

**Agente B, banco de horas** (`apps/api`)
- Pode tocar: `modules/time-bank/**`, registro das rotas do portal, `scripts/seed-dev.ts`, `test/portal-time-bank.test.ts`.
- Fazer: §2.3 (regra pura em `rules/posting.ts`, `repository.ts`, implementação do hook); `GET /portal/time-bank`, `GET /portal/employees/:id/time-bank`, `GET` e `PUT /portal/establishments/:id/time-bank-policy` (escrita só `rh`, com auditoria); `/me/time-bank` usando o mesmo service; escala e regra de banco no seed.
- Pronto quando: testes por tabela da regra; recálculo repetido não duplica; mudança do dia grava só a diferença; outra conta recebe 404.

**Agente C, front** (só `apps/portal`)
- Fazer: trocar os `missing()` de `endpoints/timesheets.ts` e `endpoints/time-bank.ts` pelos contratos de §3 (mocks iguais); em `/rh/apuracao`, ligar o botão "Recalcular dia" e mostrar quantos recalculou e quem ficou de fora; em `/rh/banco-horas`, painel da regra do banco do estabelecimento (consulta e edição só para `rh`), com aviso quando não há regra (sem ela, nada é lançado).
- Pronto quando: as duas telas funcionam com mocks desligados contra os contratos; typecheck, lint e testes do portal passam.

### Fase 2: sessão principal (~30 min)
1. Ligar o hook do B no service do A (`container.ts` e rotas).
2. Conferir o front contra a API real (formas das respostas).
3. `pnpm -r typecheck && pnpm -r lint && pnpm -r test`.
4. Ponta a ponta local: `pnpm dev:punch`, conferir a apuração e as duas telas.
5. Requests no Postman; atualizar G4 e G8 em `04`, a fila nova em `SPEC-nsr-fila.md` e `fila-batidas.md`.

### Corte, se faltar tempo
Ordem de valor: carga de parâmetros → fila e consumidor → tela do dia → lançamento no banco → telas do banco → `close-days` → resgate da fila nova. Fica de fora hoje: pagamento no vencimento (`settleExpiredCredits`), liquidação no desligamento, folga compensatória, troca de turno e feriados.

## 5. Prompt para disparar

> Execute `docs/prompts/apuracao-banco-horas-orquestracao.md`: faça a Fase 0, dispare os agentes A, B e C em paralelo (modelo sonnet, cada um lendo só o plano e os arquivos do seu escopo) e depois faça a Fase 2. Não faça commit sem eu pedir.
