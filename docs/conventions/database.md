# Convenções de banco de dados (PostgreSQL)

> Vale para os dois bancos lógicos (`app` e `arp`). A regra de ouro: **um conceito, um padrão de nome e de tipo**. Se uma coluna nova não cabe em nenhuma linha da tabela da §4, a convenção é que está incompleta: atualize este documento no mesmo commit.
> Base: o schema da Visage (`visage/.claude/database.md`), com as inconsistências corrigidas (ver §15).

---

## 1. Princípios

1. **Identificadores em inglês, `snake_case`.** Siglas da Portaria e do domínio ficam como são (`cpf`, `cnpj`, `nsr`, `afd`, `aej`, `dsr`, `cid`, `crm`, `inpi`). Documentação e mensagens em pt-BR. O mapa de termos está na §12.
2. **O tipo diz a unidade.** Duração em minutos inteiros, dinheiro em `NUMERIC`, dia em `DATE`, instante em `TIMESTAMPTZ`. Nunca `FLOAT` para dinheiro ou tempo.
3. **O sufixo diz o tipo.** Quem lê `approved_at` sabe que é `TIMESTAMPTZ`; quem lê `work_date`, que é `DATE`.
4. **Dado fiscal e dado de auditoria não se alteram.** Correção é um novo registro, nunca um `UPDATE`.
5. **Sem soft delete.** O estado de vida é explícito (`status`, `end_date`, `is_active`).
6. **O banco defende o que o código esquece:** `NOT NULL`, `CHECK`, `UNIQUE`, FK e exclusion constraints no schema, não só na validação.

## 2. Dois bancos

| Banco | Papel | Regras extras |
|---|---|---|
| `arp` | Armazenamento de Registro de Ponto (fiscal) | Só o `rep-core` tem INSERT. Trigger recusa `UPDATE`/`DELETE` em `records` e `punch_evidences`. Demais serviços: somente leitura. Migrations escritas à mão em SQL, com teste da imutabilidade |
| `app` | Operacional: cadastros, apuração, pedidos, atestados, banco de horas, fechamento | Tudo desta convenção. Acesso por Drizzle |

O `app` nunca copia marcações do `arp`. Referencia por `(establishment_id, nsr)` quando precisa apontar uma marcação original.

## 3. Nomes

| Objeto | Regra | Exemplo |
|---|---|---|
| Tabela | plural, `snake_case`, substantivo | `employees`, `time_adjustment_requests` |
| Tabela de ligação | os dois lados, no plural | `class_subject_teachers` |
| Ledger (só INSERT) | sufixo `_entries` | `time_bank_entries` |
| Histórico com vigência | sufixo `_history` | `employee_job_history` |
| Catálogo | sufixo `_types` | `leave_types` |
| Coluna | `snake_case`; no código TypeScript vira `camelCase` (Drizzle) | `tenant_id` → `tenantId` |
| Chave primária | `pk_<tabela>` | `pk_employees` |
| Chave estrangeira | `fk_<tabela>_<pai_no_singular>` | `fk_time_adjustment_requests_employee` |
| Unique | `uq_<tabela>_<colunas>` | `uq_employees_tenant_id_cpf` |
| Check | `ck_<tabela>_<o_que>` | `ck_employees_status` |
| Exclusion | `ex_<tabela>_<o_que>` | `ex_employee_schedules_no_overlap` |
| Índice | `idx_<tabela>_<colunas>` | `idx_employees_tenant_id_status` |

## 4. Colunas padrão

| Conceito | Padrão | Observação |
|---|---|---|
| Chave primária | `id BIGINT GENERATED ALWAYS AS IDENTITY` | Sempre `BIGINT`, mesmo em tabela pequena: evita FK com tipos diferentes. No TypeScript, `mode: 'number'` |
| ID público | `public_id UUID NOT NULL DEFAULT gen_random_uuid()` + `UNIQUE` | Só onde o ID sai do sistema (QR, link, URL assinada). O `id` sequencial nunca é exposto fora do portal autenticado |
| Tenant | `tenant_id BIGINT NOT NULL`, **logo após `id`** | Ver §6 |
| Chave estrangeira | `<tabela_no_singular>_id BIGINT` | Por papel quando há mais de uma ou é autorreferência: `manager_id`, `parent_id`, `counterpart_employee_id` |
| Instante | `<verbo_no_passado>_at TIMESTAMPTZ` | `created_at`, `approved_at`, `closed_at`, `punched_at`. Sempre UTC no banco |
| Dia | `<substantivo>_date DATE` | `work_date`, `admission_date`, `holiday_date`. Dia **no fuso do estabelecimento** |
| Hora do dia | `<substantivo>_time TIME` | `start_time`, `break_start_time`. Relógio local do estabelecimento |
| Vigência | `start_date DATE NOT NULL`, `end_date DATE` | `NULL` = em aberto; `end_date` é **inclusivo**. Ver §7 |
| Duração | `<nome>_minutes INTEGER` | `worked_minutes`, `overtime_minutes`. Saldo pode ser negativo |
| Dinheiro | `<nome>_amount NUMERIC(12,2)` | Sempre BRL. Moeda não é coluna |
| Taxa | `<nome>_rate NUMERIC(6,4)` | `0.5000` = 50% |
| Booleano | `is_<estado>` ou `has_<coisa>`, `NOT NULL DEFAULT` | `is_active`, `has_signature`. Sem `NULL`: três valores em booleano é bug |
| Texto | `TEXT` | Sem `VARCHAR(n)`. Limite de tamanho, se a regra exigir, por `CHECK (char_length(x) <= n)` |
| Status | `status TEXT NOT NULL` + `CHECK` | Valores `snake_case` em inglês: `pending`, `approved`, `rejected`, `canceled` (grafia americana, sempre). Ver §9 |
| Discriminador | `kind TEXT NOT NULL` + `CHECK` | Subtipo dentro da tabela. **Não** use `type` |
| Ator | `<verbo_no_passado>_by_id BIGINT REFERENCES users(id)` | `created_by_id`, `decided_by_id`. `NULL` = sistema |
| Motivo | `reason` (quem pede) · `decision_note` (quem decide) | `decision_note` é o que o solicitante enxerga ao ser recusado |
| Arquivo no S3 | `<nome>_key TEXT` + `<nome>_sha256 BYTEA` + `<nome>_mime TEXT` + `<nome>_size_bytes BIGINT` | `_key` é a chave do objeto, **nunca URL**. A URL é assinada na hora de servir |
| Dado cifrado | `<nome>_enc BYTEA` | Envelope `iv ‖ tag ‖ ciphertext`; a versão da chave fica em `key_version SMALLINT` na tabela. Ver §10 |
| Hash / índice cego | `<nome>_hash BYTEA` | HMAC-SHA-256 para buscar por valor cifrado sem decifrar |
| JSON | `JSONB`, nomeado pelo conteúdo | `metadata`, `findings`, `params`. Nunca para dado relacional que se filtra ou junta |
| Escore | `<nome>_score` | `REAL` para biometria (`liveness_score`); `SMALLINT` 0–100 para risco (`risk_score`) |
| CPF / CNPJ | `cpf CHAR(11)` · `cnpj CHAR(14)` | **Só dígitos**, `CHECK (cpf ~ '^[0-9]{11}$')`. Empregador pode ser pessoa física: `document_type` (`cpf`/`cnpj`) + `document` |
| Marcação de linha | `created_at`, `updated_at`, `created_by_id` | `updated_at` por trigger `set_updated_at()`. Tabela só-INSERT **não** tem `updated_at` |

**Ordem das colunas na tabela:** `id`, `tenant_id`, FKs, dados do negócio, status e seus carimbos, JSON/cifrados, `created_at`, `updated_at`, `created_by_id`.

## 5. Constraints e índices

- Todo `NOT NULL` que a regra de negócio exige **é** `NOT NULL` no banco.
- Todo conjunto fechado de valores é `CHECK (... IN (...))`, nomeado `ck_<tabela>_<coluna>`. Não use `ENUM` do Postgres: alterar enum em migration é doloroso.
- **Todo FK ganha índice.** Índices compostos começam por `tenant_id`.
- Fila de pendências usa **índice parcial**: `CREATE INDEX idx_x ON x (tenant_id, created_at) WHERE status = 'pending'`.
- `ON DELETE`: `RESTRICT` por padrão. `CASCADE` só em tabela-filha que não faz sentido sozinha. Nunca `CASCADE` a partir de `employees` ou `tenants`.

## 6. Multi-tenant

- Toda tabela de negócio tem `tenant_id` e **toda `UNIQUE` o inclui**: `UNIQUE (tenant_id, cpf)`, nunca `UNIQUE (cpf)`.
- **FK composta entre tabelas do mesmo tenant.** Toda tabela com `tenant_id` tem `UNIQUE (tenant_id, id)`; as filhas referenciam `(tenant_id, pai_id)`. Assim um bug no código não consegue ligar um pedido do tenant A a um colaborador do tenant B.
- O repositório exige `tenantId` em **todo** método. Query sem ele não compila.
- **Exceção: catálogos globais** mantidos pelo Genus (feriados nacionais, licenças legais, regra legal de jornada) têm `tenant_id NULL` = vale para todos. `CHECK`/permissão impedem o tenant de alterar linha global; a leitura usa `tenant_id = $1 OR tenant_id IS NULL`. `UNIQUE` sobre colunas com `tenant_id` nulável usa `NULLS NOT DISTINCT` (PostgreSQL 15+). O tenant **acrescenta** as suas (feriado municipal, convenção coletiva) em linhas próprias.
- **Hierarquia do cliente:** `tenants` (conta) → `companies` (empregador) → `establishments` (local; tem sua sequência de NSR no `arp`). Colaborador pertence a um estabelecimento.
- **[A DECIDIR]** Row-Level Security como segunda barreira (`SET LOCAL app.tenant_id` por transação). A Visage não usa. Recomendado avaliar após o MVP.

## 7. Vigência (histórico por período)

Para tudo que muda no tempo e precisa responder "qual valia na data X": escala do colaborador, regra de jornada, cargo/salário, política de banco de horas.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE employee_schedules (
  id           BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id    BIGINT NOT NULL,
  employee_id  BIGINT NOT NULL,
  template_id  BIGINT NOT NULL,
  start_date   DATE   NOT NULL,
  end_date     DATE,                          -- NULL = em aberto; inclusivo
  -- ...
  CONSTRAINT ck_employee_schedules_period CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT ex_employee_schedules_no_overlap EXCLUDE USING gist (
    tenant_id   WITH =,
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
);
```

- Encerrar uma vigência é **atualizar `end_date`** da linha aberta e inserir a nova no dia seguinte, na mesma transação.
- A consulta "vigente em D" é sempre `start_date <= D AND (end_date IS NULL OR end_date >= D)`. Encapsule em função do repositório; não reescreva à mão.

## 8. Ledger e tabelas só-INSERT

Banco de horas, trilha de auditoria, tratamentos de marcação e todo o `arp` seguem:

- **Só `INSERT` e `SELECT`.** Trigger `BEFORE UPDATE OR DELETE` levanta exceção.
- Correção = **novo lançamento** com `reversal_of_id` apontando o original, mais o lançamento certo.
- Recalcular algo já lançado grava **a diferença**, não substitui.
- Idempotência por `UNIQUE` sobre a chave de origem (`source_kind`, `source_id`), para o job poder rodar duas vezes sem duplicar.
- O saldo é sempre derivado (`SUM`), nunca coluna mantida à mão.

## 9. Workflow de status

Pedido que passa por aprovação (ajuste, atestado, férias, folga compensatória) usa o mesmo molde:

| Coluna | Tipo | Sentido |
|---|---|---|
| `status` | `TEXT` + `CHECK` | `pending` → `approved` / `rejected` / `canceled` |
| `requested_by_id`, `requested_at` | `BIGINT`, `TIMESTAMPTZ` | Quem pediu e quando (`created_at` pode servir) |
| `decided_by_id`, `decided_at` | `BIGINT`, `TIMESTAMPTZ` | Quem decidiu e quando |
| `decision_note` | `TEXT` | Motivo da decisão, visível ao solicitante |
| `canceled_at` | `TIMESTAMPTZ` | Quando o solicitante desistiu |

`CHECK` amarra estado e carimbo: `status <> 'approved' OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL)`. A regra "ninguém decide o próprio pedido" fica no service **e** num `CHECK (decided_by_id IS DISTINCT FROM requested_by_id)`.

## 10. Dados cifrados e arquivos

- **Biometria:** embeddings seguem o contrato da engine (`embedding_iv`, `embedding_tag`, `embedding_ct`, `key_version`): três colunas `BYTEA`, DEK do tenant. É a **única** exceção ao padrão `_enc`.
- **Dado de saúde** (CID, texto de OCR, nome extraído de atestado): coluna `<nome>_enc BYTEA`, mesma DEK do tenant, AES-256-GCM, IV único por operação. Busca por igualdade, se necessária, via `_hash`.
- **CPF:** guardado em claro em `employees.cpf` (o AFD/ARP exige e é chave de busca), protegido por controle de acesso e criptografia do volume. **[A DECIDIR]** O doc `02` §8 fala em cifrar CPF em repouso; CPF não é dado sensível pela LGPD, então a proposta é cifrar só saúde e biometria. Confirmar.
- **Arquivos:** só a `_key` do objeto no banco. Prefixo no bucket: `tenants/{tenant_id}/<dominio>/<yyyy>/<uuid>`. Bucket privado, URL assinada de vida curta, sempre auditada. Ver `security-lgpd.md`.

## 11. Auditoria

Reaproveita o desenho de `audit_logs` da Visage, com os tipos do Genus:

- Só INSERT. Colunas: ator (snapshot de nome/e-mail/papel), `session_id`, `action` (`<dominio>.<verbo>`, do catálogo em `apps/api/src/lib/audit-events.ts`), `category`, `severity` (`info`/`warning`/`critical`), `status` (`success`/`failure`), alvo (`target_kind`, `target_id`, `target_label`; sem FK, o alvo pode ter sido excluído), `before_state`/`after_state` (`JSONB`), `changed_fields TEXT[]`, origem (IP, user agent, método, caminho), `details` (frase em pt-BR), `metadata`.
- **Segredo nunca entra no diff.** `redactDiff()` troca senha, hash, chave, token, embedding, **CID e texto de atestado** por `"[redigido]"` antes de gravar.
- **Leitura de dado sensível também é evento** (`certificate.viewed`, `certificate.file_downloaded`), não só alteração.
- Ator vem do `AsyncLocalStorage` da requisição, não é passado de mão em mão.

## 12. Glossário pt-BR ↔ identificador

| Termo (pt-BR) | Identificador | Termo (pt-BR) | Identificador |
|---|---|---|---|
| conta/cliente | `tenants` | atestado | `medical_certificates` |
| empresa (empregador) | `companies` | afastamento | `absences` |
| estabelecimento | `establishments` | licença legal | `leave_types` |
| setor | `departments` | banco de horas | `time_bank_*` |
| cargo | `job_titles` | folga compensatória | `compensatory_leaves` |
| centro de custo | `cost_centers` | férias | `vacation_*` |
| colaborador | `employees` | fechamento / reabertura | `closing_periods` / `reopen_*` |
| usuário (login) | `users` | espelho de ponto | `time_mirrors` |
| escala / modelo de escala | `schedule_templates` / `employee_schedules` | ciência do espelho | `mirror_acknowledgements` |
| feriado | `holidays` | aviso | `notifications` |
| marcação / batida | `punch` | relatório | `report_jobs` |
| apuração do dia | `daily_timesheets` | exportação para a folha | `payroll_exports` |
| ajuste / justificativa | `time_adjustment_requests` | abono | `time_waivers` |

**Banco `arp` (nomes em português dos docs `02` e `03` → identificadores):**

| Doc `02`/`03` | Identificador | Observação |
|---|---|---|
| `registros` | `records` | tipos 2, 4, 5, 6 e 7 do AFD |
| `evidencias` | `punch_evidences` | dados internos que não vão ao AFD |
| `entrada` | `intake` | outbox da api-coletor |
| `sequencia_estabelecimento` | `establishment_sequences` | `last_nsr`, `last_hash` |
| `outbox` | `outbox` | igual |
| colunas `nsr`, `tipo`, `dh_marcacao`, `dh_gravacao`, `coletor`, `hash` | `nsr`, `record_type`, `punched_at`, `recorded_at`, `collector_kind`, `hash` | `is_offline` para a flag on/off do AFD |

**Jobs e filas:** `calcular_jornada` ≡ `recalculate-day` · `gerar_pdf` ≡ `generate-receipt-pdf` · `espelho_mensal` ≡ `generate-mirror` · `verificar_foto` ≡ `verify-photo` · `selo_worm` ≡ `seal-worm` · `conferir_cadeias` ≡ `verify-chains` · `limpar_fotos` ≡ `purge-photos`.

## 13. Migrations

- Ferramenta: `drizzle-kit generate` para o `app`. Arquivos `NNNN_descricao.sql` numerados pela ferramenta; a descrição em inglês, `snake_case`.
- **Nunca edite uma migration já aplicada**, nem em dev compartilhado. Erro se corrige com migration nova.
- Uma migration, uma intenção. Mudança de schema e carga de dados em arquivos separados. Dados iniciais (feriados nacionais, licenças legais) ficam em `db/seeds/`, idempotentes.
- Migration destrutiva (`DROP`, mudança de tipo) leva comentário com o plano de reversão e passa por revisão.
- `arp`: SQL escrito à mão, com os triggers de imutabilidade; um teste automatizado tenta `UPDATE`/`DELETE` e espera falha.

## 14. Exemplo completo

```sql
CREATE TABLE employees (
  id                BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id         BIGINT NOT NULL,
  company_id        BIGINT NOT NULL,
  establishment_id  BIGINT NOT NULL,
  department_id     BIGINT,
  job_title_id      BIGINT,
  manager_id        BIGINT,
  registration_code TEXT,
  full_name         TEXT NOT NULL,
  cpf               CHAR(11) NOT NULL,
  admission_date    DATE NOT NULL,
  termination_date  DATE,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_id     BIGINT,
  CONSTRAINT pk_employees PRIMARY KEY (id),
  CONSTRAINT uq_employees_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_employees_tenant_id_cpf UNIQUE (tenant_id, cpf),
  CONSTRAINT fk_employees_tenant FOREIGN KEY (tenant_id) REFERENCES tenants (id),
  CONSTRAINT fk_employees_establishment FOREIGN KEY (tenant_id, establishment_id) REFERENCES establishments (tenant_id, id),
  CONSTRAINT fk_employees_manager FOREIGN KEY (tenant_id, manager_id) REFERENCES employees (tenant_id, id),
  CONSTRAINT ck_employees_status CHECK (status IN ('active', 'on_leave', 'terminated')),
  CONSTRAINT ck_employees_cpf CHECK (cpf ~ '^[0-9]{11}$'),
  CONSTRAINT ck_employees_termination CHECK (termination_date IS NULL OR termination_date >= admission_date)
);
CREATE INDEX idx_employees_tenant_id_status ON employees (tenant_id, status);
CREATE INDEX idx_employees_tenant_id_manager_id ON employees (tenant_id, manager_id);

CREATE TABLE time_adjustment_requests (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  tenant_id       BIGINT NOT NULL,
  employee_id     BIGINT NOT NULL,
  work_date       DATE NOT NULL,
  kind            TEXT NOT NULL,
  requested_time  TIME,
  reason          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  requested_by_id BIGINT NOT NULL,
  decided_by_id   BIGINT,
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pk_time_adjustment_requests PRIMARY KEY (id),
  CONSTRAINT uq_time_adjustment_requests_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_time_adjustment_requests_employee FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
  CONSTRAINT ck_time_adjustment_requests_kind CHECK (kind IN ('add_punch', 'disregard_punch', 'justify_absence', 'justify_delay')),
  CONSTRAINT ck_time_adjustment_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  CONSTRAINT ck_time_adjustment_requests_decision CHECK (
    status = 'pending' OR status = 'canceled' OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT ck_time_adjustment_requests_no_self_decision CHECK (decided_by_id IS DISTINCT FROM requested_by_id)
);
CREATE INDEX idx_time_adjustment_requests_pending
  ON time_adjustment_requests (tenant_id, created_at) WHERE status = 'pending';
CREATE INDEX idx_time_adjustment_requests_employee_work_date
  ON time_adjustment_requests (tenant_id, employee_id, work_date);
```

## 15. Divergências em relação à Visage (para quem vem de lá)

| Visage | Genus | Motivo |
|---|---|---|
| `SERIAL`/`INT` em umas tabelas, `TEXT` nas de auditoria | `BIGINT` identity em todas | FK sem conversão de tipo |
| `created_at TIMESTAMPTZ DEFAULT NOW()` (aceita `NULL`) | `NOT NULL DEFAULT now()` | Carimbo ausente é bug |
| `starts_at DATE` | `start_date DATE` | O sufixo diz o tipo |
| `created_by` e `created_by_id` misturados | sempre `_by_id` | Uma regra |
| `VARCHAR(n)` | `TEXT` + `CHECK` quando preciso | Sem limite arbitrário |
| `*_type` (`actor_type`, `target_type`) | `kind` (`target_kind`) | Uma palavra para o discriminador |
| `status` sem `CHECK` em alguns lugares | `CHECK` sempre | O banco rejeita valor inválido |
| FK simples por `tenant_id` | FK composta `(tenant_id, id)` | Isolamento garantido pelo schema |
| `document` para CPF | `cpf` / `cnpj` (e `document` só para empregador) | Clareza para a Portaria |
