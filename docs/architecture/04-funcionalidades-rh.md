# 04 · Funcionalidades de RH: planejamento e encaixe na arquitetura

> Documento 4 de 4. Continua `01-contexto-e-portaria.md`, `02-arquitetura.md` e `03-funcionalidades-e-modos.md`, que **não foram alterados** e seguem valendo.
> **Fonte:** quadro Lucidchart "Funcionalidades do sistema de RH por painel", lido em 18/11/2026. É uma lista por painel e módulo, sem relacionamentos. **Roxo = MVP (entrega 25/11/2026). Azul = fase 2.** O quadro informa que reconhecimento facial e coleta offline já estão prontos e não aparecem nele.
> **Para quem for revisar:** **[A CONFIRMAR]** marca interpretação ou regra trabalhista ainda não validada com contador/jurídico; **[A DECIDIR]** marca escolha técnica ou de produto em aberto (§9). Nomes de tabela e coluna seguem `docs/conventions/database.md`.

---

## 1. Como as funcionalidades entram na arquitetura

### 1.1 Em uma frase

Quase tudo é **um módulo novo no `api-portal` (Fastify) + tabelas novas no banco `app`**. Só três itens saem desse molde: o cálculo da jornada (worker com regras puras), a leitura de atestado (worker de OCR) e a geração de arquivos (espelho, AEJ, relatórios, que passam pelo `signer`). **Nada escreve no `arp`.**

### 1.2 Onde cada coisa mora

```
 Portais (Next.js)          api-portal (Fastify)                         Workers (BullMQ)
 ───────────────           ───────────────────────────────────          ─────────────────────────
 RH / gestor   ──────────► modules/employees   modules/schedules   ──►  recalculate-day  (PTRP)
 Funcionário   ──/me/*───► modules/holidays    modules/timesheets        analyze-certificate (OCR)
 (PWA, celular)            modules/adjustments modules/certificates      generate-mirror / aej
                           modules/absences    modules/time-bank         check-deadlines (diário)
                           modules/closings    modules/dashboard         generate-report · send-notification
                           modules/reports     modules/notifications
                                  │                  │                              │
                                  ▼                  ▼                              ▼
                           PostgreSQL `app`    PostgreSQL `arp`  ◄── só leitura ── workers
                           (escreve)           (só o rep-core escreve)
                                  │
                                  ▼
                           S3: atestados (cifrados) · espelhos · AEJ · relatórios
```

### 1.3 Regras de encaixe

1. **O `arp` é só leitura para o portal e para os workers.** O cálculo lê as marcações pelo papel somente leitura (`ArpReader`). Ajuste, abono e justificativa são tabelas do `app` que **se somam** à marcação original (art. 82, parágrafo único). A original nunca muda.
2. **O cadastro de colaborador também vai ao ARP.** Criar ou alterar empregador/empregado gera registro tipo 2/5 no `arp`, pelo `rep-core` (`03` §2.2). O módulo de cadastros publica o evento; ele não escreve no `arp`.
3. **Toda mudança que afeta o dia publica `recalculate-day`** (o `calcular_jornada` de `03` §8) pelo outbox, com `jobId` determinístico `recalculate-day:{employeeId}:{workDate}`. É o mesmo evento que o `rep-core` já emite a cada batida e **na chegada de lote offline**.
4. **Período fechado não é recalculado em silêncio.** Se uma batida offline tardia cair em dia já fechado, o dia permanece como está, o RH é avisado e **só ele** reabre o período, com motivo (módulo 10).
5. **O sistema não bloqueia batida.** Inconsistência, atraso ou falta só **sinalizam** na apuração.
6. **Tudo é multi-tenant e auditado**, conforme `database.md` §6 e §11.

### 1.4 Papéis

| Papel | Quem | Alcance |
|---|---|---|
| `super_admin` | Operação do Genus | Conta e saúde dos serviços. **Não** lê dado de saúde nem biometria |
| `admin` | RH do cliente | Tudo do tenant, inclusive CID |
| `manager` | Gestor | **Só a própria equipe** (`manager_id`). Aprova pedidos. Sem CID, sem arquivo de atestado, sem salário |
| `employee` | Colaborador | Só o que é dele, em `/me/*` |

### 1.5 Estrutura de um módulo

Cada módulo segue `docs/conventions/backend.md` §2: `routes.ts` · `schemas.ts` · `service.ts` · `repository.ts` · `events.ts` · `rules/`. Prefixo `/portal` omitido nas rotas abaixo. Corpo, query e resposta em `camelCase`.

---

## 2. Visão geral dos módulos

| # | Módulo | Fase | Onde roda | Tabelas principais | Integração externa |
|---|---|---|---|---|---|
| **Painel de gestão** | | | | | |
| G1 | Cadastros | MVP | api-portal | `companies`, `establishments`, `departments`, `job_titles`, `cost_centers`, `employees`, `employee_job_history` | Nenhuma (grava tipo 2/5 no ARP via rep-core) |
| G2 | Escalas e jornada | MVP | api-portal | `schedule_templates`, `schedule_template_days`, `employee_schedules`, `schedule_overrides`, `workweek_rules` | Nenhuma |
| G3 | Feriados | MVP | api-portal + job anual | `holidays`, `holiday_work_rules` | Nenhuma (cálculo local) |
| G4 | Apuração do ponto | MVP | worker + regras puras | `daily_timesheets`, `timesheet_intervals`, `company_settings` | Lê o ARP |
| G5 | Ajustes e justificativas | MVP | api-portal | `time_adjustment_requests`, `treated_punches`, `time_waivers` | Nenhuma |
| G6 | Análise heurística de atestados | MVP | worker (OCR) + api-portal | `certificate_analyses` | **OCR [A DECIDIR]** |
| G7 | Atestados e afastamentos | MVP | api-portal | `medical_certificates`, `absences`, `leave_types` | Nenhuma |
| G8 | Banco de horas | MVP | api-portal + worker | `time_bank_policies`, `time_bank_enrollments`, `time_bank_entries`, `compensatory_leaves` | Nenhuma |
| G9 | Férias | Fase 2 | api-portal | `vacation_periods`, `vacation_installments` | Nenhuma |
| G10 | Fechamento e espelho | MVP / Fase 2 | api-portal + worker + signer | `closing_periods`, `closing_period_events`, `closing_snapshots`, `time_mirrors`, `aej_exports` | `signer` (interno); geração de PDF |
| G11 | Painel do dia e indicadores | MVP | api-portal (leitura) | nenhuma nova | Nenhuma |
| G12 | Relatórios e exportação | Fase 2 | worker | `report_jobs`, `payroll_event_codes`, `payroll_exports` | **Folha [A DECIDIR]**, e-mail, WhatsApp |
| **Painel do funcionário (celular)** | | | | | |
| E1 | Meu ponto | MVP | api-portal `/me` | `mirror_acknowledgements` | Nenhuma |
| E2 | Meus pedidos | MVP | `/me` sobre G5 | (reusa G5) | Nenhuma |
| E3 | Meus atestados | MVP | `/me` sobre G6/G7 | (reusa G6/G7) | S3 (URL assinada) |
| E4 | Meu banco de horas | MVP | `/me` sobre G8 | (reusa G8) | Nenhuma |
| E5 | Minhas férias | Fase 2 | `/me` sobre G9 | (reusa G9) | Nenhuma |
| E6 | Avisos | Fase 2 | api-portal + worker | `notifications`, `notification_preferences` | **E-mail, WhatsApp, Web Push [A DECIDIR]** |

Só **três** módulos têm integração externa: G6 (OCR), G12 e E6 (canais de aviso e folha). **Nenhum** do MVP precisa de API externa além do OCR.

---

## 3. Painel de gestão (RH e gestor)

### G1 · Cadastros (MVP)

**Tabelas:** `companies` (`legal_name`, `trade_name`, `document_type`, `document`) · `establishments` (`company_id`, `name`, `document_type`, `document`, endereço, `state_code`, `municipality_code`, `timezone`) · `departments` · `job_titles` (`name`, `cbo_code`) · `cost_centers` (`code`, `name`) · `employees` (`company_id`, `establishment_id`, `department_id`, `job_title_id`, `cost_center_id`, `manager_id`, `user_id`, `registration_code`, `full_name`, `cpf`, `admission_date`, `termination_date`, `termination_reason`, `contract_kind`, `status`, `facial_person_id`, `facial_status`) · `employee_job_history` (`employee_id`, `job_title_id`, `department_id`, `salary_amount`, `start_date`, `end_date`; **vigência**, sem sobreposição).

**Endpoints:** `/companies`, `/establishments`, `/departments`, `/job-titles`, `/cost-centers` (CRUD) · `/employees` (CRUD) · `POST /employees/:id/terminate` · `GET|POST /employees/:id/job-history` · `PUT /employees/:id/facial-link`.

**Regras:**
- **Hierarquia:** conta (`tenants`) → empresa → estabelecimento → colaborador. O estabelecimento é a unidade da sequência de NSR no ARP.
- **Desligamento** não apaga: define `termination_date`, `status = terminated`, encerra a escala vigente (G2) e **apaga a galeria facial** (evento `employee.terminated` → `DELETE /embeddings/{tenant}/{person}` na engine). O histórico fica.
- **Salário** vem do `employee_job_history` vigente e só é visível ao RH. Mudar cargo/salário **abre nova vigência**, não sobrescreve.
- **Vínculo facial:** `employees.facial_person_id` guarda o `person_id` que a engine usa nos candidatos. **[A DECIDIR]** onde mora a base facial "existente" (§9, item 5).
- **CPF** único por tenant (`UNIQUE (tenant_id, cpf)`); validação dos dígitos verificadores no service.
- Criar/alterar colaborador publica `employee.changed` → `rep-core` grava o registro tipo 5.

**Atenção:** sem importação em massa o onboarding de uma empresa de 100 pessoas é inviável; ver §8.

### G2 · Escalas e jornada (MVP)

**Tabelas:**
- `schedule_templates` (`name`, `kind` = `5x2`|`6x1`|`12x36`|`free`, `cycle_days`, `weekly_minutes`, `is_active`)
- `schedule_template_days` (`template_id`, `day_index`, `is_day_off`, `start_time`, `end_time`, `break_start_time`, `break_minutes`, `expected_minutes`)
- `employee_schedules` (`employee_id`, `template_id`, `cycle_anchor_date`, `start_date`, `end_date`). **Vigência**, sem sobreposição por colaborador
- `schedule_overrides` ("troca pontual": `employee_id`, `work_date`, `kind` = `shift_change`|`day_off`|`extra_work`, `start_time`, `end_time`, `reason`, `created_by_id`)
- `workweek_rules` (`max_weekly_minutes`, `max_daily_minutes`, `start_date`, `end_date`, `source` = `law`|`agreement`). **Catálogo global** (`tenant_id NULL` = regra legal do Genus) + linhas do tenant para convenção coletiva

**Endpoints:** `/schedule-templates` (CRUD) · `POST /employees/:id/schedules` (atribui com vigência) · `/schedule-overrides` · `/workweek-rules` · `POST /schedules/validate` (simulação, devolve alertas) · `GET /schedules/calendar?from&to&departmentId` (calendário da equipe).

**Regras:**
- **Modelo cíclico:** a escala é um ciclo de `cycle_days` dias (7 para 5x2 e 6x1; 2 para 12x36) a partir de `cycle_anchor_date`. O dia da escala é `(work_date − anchor) mod cycle_days`. Assim 12x36 e semanais usam a mesma estrutura.
- **Regra de jornada versionada (44h, 42h, 40h):** `workweek_rules` com vigência. O sistema escolhe a regra vigente **na data**, então uma mudança de lei é uma linha nova, sem deploy.
- **"Alerta de escala acima do limite":** `POST /schedules/validate` e o salvamento devolvem **avisos, não bloqueio**: carga semanal acima do limite vigente, jornada diária acima do máximo, **interjornada menor que 11 h**, mais de 6 dias seguidos sem folga **[A CONFIRMAR: parâmetros e artigos da CLT com o jurídico]**. O RH pode salvar mesmo assim.
- **Calendário da equipe:** leitura derivada (modelo + vigência + trocas + feriados), sem tabela própria.

**Eventos:** atribuir escala, criar troca ou mudar regra → `recalculate-day` para os dias afetados (futuros: só o calendário; passados e abertos: recalcula).

### G3 · Feriados (MVP)

**Tabelas:** `holidays` (`tenant_id` NULL = global, `holiday_date`, `name`, `scope` = `national`|`state`|`municipal`, `kind` = `holiday`|`optional`, `state_code`, `municipality_code`) · `holiday_work_rules` (`company_id`, `treatment` = `paid_overtime`|`time_bank`|`compensatory_leave`, `overtime_rate`, vigência).

**Endpoints:** `GET /holidays?year&establishmentId` · `POST|PATCH /holidays` (municipais, estaduais e pontos facultativos do tenant) · `/holiday-work-rules`.

**Regras:**
- **Nacionais automáticos:** job `seed-holidays` calcula o ano (datas fixas + Páscoa para Sexta-feira Santa, e Carnaval/Corpus Christi como **ponto facultativo**) e grava em `holidays` global. **Sem API externa**: a consulta vira um `JOIN` simples.
- **Estaduais e municipais:** o tenant cadastra por estabelecimento (UF e código IBGE do município). Pode haver um *seed* estático de feriados estaduais por UF.
- **Ponto facultativo** (`kind = optional`) **não** vira feriado na apuração a menos que o RH ative para o tenant.
- **Feriado trabalhado:** `holiday_work_rules` define o tratamento (hora extra a 100%, banco de horas ou folga compensatória). Padrão a **[A CONFIRMAR]** com o contador/convenção.
- A lista de feriados nacionais deve ser conferida a cada ano **[A CONFIRMAR]** (a lei muda).

### G4 · Apuração do ponto (MVP)

É o **PTRP**: lê as marcações e produz o dia calculado, **sem nunca alterá-las**.

**Tabelas:**
- `daily_timesheets` (`employee_id`, `work_date`, `day_kind` = `work`|`day_off`|`holiday`|`absence`|`vacation`|`compensated`, `expected_minutes`, `worked_minutes`, `break_minutes`, `late_minutes`, `early_leave_minutes`, `absence_minutes`, `waived_minutes`, `overtime_minutes`, `day_off_overtime_minutes`, `night_minutes`, `night_additional_minutes`, `status` = `calculated`|`inconsistent`|`closed`, `inconsistency_codes TEXT[]`, `calc_version`, `calculated_at`, `closing_id`). `UNIQUE (tenant_id, employee_id, work_date)`
- `timesheet_intervals` (`timesheet_id`, `kind` = `work`|`break`, `started_at`, `ended_at`, `source` = `original`|`treated`, `establishment_id`, `nsr`)
- `company_settings` (parâmetros por empresa, abaixo)

**Parâmetros (`company_settings`), todos configuráveis, nenhum fixo no código:**

| Parâmetro | Padrão sugerido | Base |
|---|---|---|
| `tolerance_per_punch_minutes` | 5 | CLT art. 58 §1º **[A CONFIRMAR]** |
| `tolerance_per_day_minutes` | 10 | idem |
| `night_start_time` / `night_end_time` | 22:00 / 05:00 | trabalho urbano **[A CONFIRMAR]** |
| `has_reduced_night_hour` | true (52 min 30 s) | CLT art. 73 §1º **[A CONFIRMAR]** |
| `night_additional_rate` | 0.2000 | **[A CONFIRMAR]** (convenção pode alterar) |
| `overtime_rate` / `day_off_overtime_rate` | 0.5000 / 1.0000 | **[A CONFIRMAR]** |
| `certificate_deadline_hours` | a definir | G6 |
| `high_balance_minutes`, `expiry_alert_days` | a definir | G8 |

**Algoritmo do dia** (função pura em `packages/timekeeping-rules`):

1. **Carrega as marcações** do estabelecimento no intervalo do dia, com margem para turno que cruza a meia-noite. O dia de trabalho é o dia em que o turno **começou**.
2. **Aplica** tratamentos aprovados (`treated_punches`: acrescentadas e desconsideradas), abonos, afastamento, feriado, troca pontual e folga compensatória.
3. **Pareia** entradas e saídas segundo a escala. Quantidade ímpar vira inconsistência (e **marcação ímpar no AEJ pode gerar autuação**, `01` §3.7).
4. **Calcula** trabalhado, intervalo, atraso, saída antecipada, falta, extras (a 50% e a 100%), noturno e adicional noturno.
5. **Decide o destino das extras** (pagar ou banco de horas) conforme a política do colaborador (G8) e grava os lançamentos do banco **por diferença**.
6. **Grava** `daily_timesheets` e `timesheet_intervals` e marca `calc_version`.

**Inconsistências** (`inconsistency_codes`): `odd_punches`, `missing_break`, `missing_exit`, `punch_outside_schedule`, `duplicate_punch`, `exceeds_daily_limit`, `unreviewed_late_punch`. São **sinais**, não bloqueios (art. 74).

**DSR** (descanso semanal remunerado sobre extras) depende da semana inteira; é calculado **no fechamento** (G10), não no dia. **[A CONFIRMAR]** a fórmula com o contador.

**Endpoints:** `GET /timesheets?employeeId&from&to&status` · `GET /timesheets/:employeeId/:workDate` (dia com marcação original ao lado da tratada) · `POST /timesheets/recalculate` (RH, assíncrono, devolve o id do job) · `GET /timesheets/inconsistencies`.

**Gatilhos de recálculo:** marcação nova (inclusive **lote offline**) · pedido aprovado (G5) · abono · afastamento aprovado (G7) · troca de escala, feriado ou parâmetro. Se o dia está **fechado**: não recalcula; gera alerta (`1.3`, item 4).

### G5 · Ajustes e justificativas (MVP)

**Tabelas:**
- `time_adjustment_requests` (esquema completo em `database.md` §14): `employee_id`, `work_date`, `kind` = `add_punch`|`disregard_punch`|`justify_absence`|`justify_delay`, `requested_time`, `reason`, `status`, `requested_by_id`, `decided_by_id`, `decided_at`, `decision_note`
- `treated_punches` (**só INSERT**, "marcação tratada separada da original"): `employee_id`, `work_date`, `kind` = `added`|`disregarded`, `punched_at`, `original_nsr`, `establishment_id`, `request_id`, `reason`, `created_by_id`, `reversal_of_id`
- `time_waivers` (abono pelo RH, **só INSERT**): `employee_id`, `work_date`, `is_full_day`, `waived_minutes`, `reason_code`, `reason`, `granted_by_id`, `reversal_of_id`

**Endpoints:** `GET /adjustment-requests?status&employeeId` (fila; o gestor vê só a equipe) · `POST /adjustment-requests` (colaborador, ou RH em nome dele) · `POST /adjustment-requests/:id/approve|reject|cancel` · `GET|POST /time-waivers`.

**Regras:**
- **Fluxo:** colaborador pede (E2) → gestor aprova ou recusa → aprovado, grava `treated_punches` e publica `recalculate-day`.
- **Ninguém decide o próprio pedido** (`CHECK` no banco e no service). Justificativa é obrigatória. Pedido sobre período fechado retorna `409 PERIOD_CLOSED` até o RH reabrir.
- **A marcação original nunca é tocada.** "Desconsiderar" cria um tratamento que a apuração aplica; a marcação segue no ARP e no AFD. Corrigir um tratamento é **outro** tratamento com `reversal_of_id`.
- **Abono** é ato do RH, com motivo, e entra na apuração como `waived_minutes` (reduz atraso/falta), nunca editando horário.
- Notificação ao colaborador da decisão: in-app no MVP; e-mail/WhatsApp na fase 2 (E6).

### G6 · Análise heurística de atestados (MVP)

**Não decide nada.** Lê o atestado, procura sinais de problema e dá uma **nota de risco com motivos**. **O RH decide** (G7).

**Tabela:** `certificate_analyses` (`certificate_id`, `engine`, `engine_version`, `ocr_confidence`, `ocr_text_enc`, `patient_name_enc`, `issue_date`, `days_off`, `doctor_name`, `crm_number`, `crm_state`, `cid_code_enc`, `has_signature`, `risk_score` 0–100, `risk_level` = `low`|`medium`|`high`, `findings JSONB`, `analyzed_at`). Uma análise por versão do motor, então reanalisar não apaga a anterior.

**Verificações (cada uma vira um item em `findings` com `code`, `severity`, mensagem em pt-BR e evidência):**

| Código | O que confere |
|---|---|
| `patient_name_mismatch` | Nome do paciente lido bate com o do colaborador |
| `dates_mismatch` | Data e dias do atestado batem com a ausência declarada |
| `crm_format_invalid` | CRM em formato válido (UF + número). **Só formato**: não há consulta a base externa |
| `signature_missing` | Há assinatura/carimbo |
| `duplicate_image` | Mesma imagem já enviada (SHA-256 exato e *hash* perceptual para variações) |
| `duplicate_certificate` | Mesmo período ou mesmo médico/data já registrado |
| `submitted_late` | Enviado depois do prazo (`certificate_deadline_hours`) |
| `recurrence_pattern` | Recorrência em segunda, sexta ou véspera de feriado (consulta o histórico de `absences`) |
| `ocr_low_confidence` | Leitura ruim: a nota **não** é confiável e o RH vê o aviso |

**Pipeline** (job `analyze-certificate`, em worker Python):

1. Baixa o arquivo do S3 → OCR → extrai campos (data, dias, médico, CRM, CID) por regras/regex.
2. Aplica as verificações → calcula a nota → grava `certificate_analyses`.
3. Move o atestado para `pending_review` e avisa o RH.
4. **Falha do OCR não trava ninguém:** o atestado vai para `pending_review` com o achado `analysis_failed`, e o RH analisa à mão.

**Integração externa:** OCR. **Recomendação: local** (Tesseract ou PaddleOCR no worker, na VM de reconhecimento, fora do pico), para o conteúdo do atestado não sair da infraestrutura. Ver §5. A nota de risco usa pesos em arquivo de regras versionado; os limiares de `risk_level` ficam **[A DEFINIR]** com dados reais.

**Dado de saúde:** `ocr_text_enc`, `patient_name_enc` e `cid_code_enc` são cifrados; **CID só para o RH** (`security-lgpd.md` §3). Nenhuma recusa automática.

### G7 · Atestados e afastamentos (MVP)

**Tabelas:**
- `medical_certificates` (`employee_id`, `file_key`, `file_sha256`, `file_mime`, `file_size_bytes`, `image_phash`, `declared_start_date`, `declared_days`, `submitted_by_id`, `submitted_at`, `is_late`, `status` = `submitted`|`analyzing`|`pending_review`|`approved`|`rejected`|`canceled`, `decided_by_id`, `decided_at`, `decision_note`, `absence_id`)
- `absences` (`employee_id`, `kind` = `medical_certificate`|`inss_leave`|`statutory_leave`|`vacation`|`other`, `leave_type_id`, `start_date`, `end_date`, `status` = `active`|`ended`|`canceled`, `source_certificate_id`, `requires_inss_referral`, `notes`, `created_by_id`). Exclusion constraint: **sem afastamentos ativos sobrepostos** por colaborador
- `leave_types` (**catálogo global**: `code`, `name`, `default_days`, `is_paid`, `legal_basis`, `requires_document`)

**Endpoints:** `GET /certificates?status&riskLevel` (fila do RH) · `GET /certificates/:id` (com análise; CID só para `admin`) · `GET /certificates/:id/file` (URL assinada, **auditada**) · `POST /certificates/:id/approve|reject` · `POST /certificates/:id/reanalyze` · `GET|POST|PATCH /absences` · `GET /leave-types`.

**Regras:**
- **Aprovar** cria o `absences` correspondente e publica `recalculate-day` para o período: **"abono automático na apuração"**. Os dias viram `day_kind = absence` e não geram falta nem desconto. **Recusar** exige `decision_note`, que o colaborador vê.
- **Alerta de mais de 15 dias (INSS):** a empresa paga os 15 primeiros dias; depois disso o caso vai ao INSS. Ao aprovar, `days > 15` marca `requires_inss_referral`; o job diário `check-deadlines` reavalia afastamentos em curso e considera retorno em até 60 dias do mesmo afastamento, **que o RH confirma** (o sistema não tem o CID de volta para comparar causas sem expô-lo) **[A CONFIRMAR]**.
- **Licenças legais com prazo pronto:** o catálogo `leave_types` traz tipo, prazo padrão e fundamento. Exemplos a **conferir com o jurídico** (CLT art. 473 e correlatos): falecimento de familiar, casamento, nascimento de filho, doação voluntária de sangue, alistamento eleitoral, maternidade. Ao registrar uma licença o prazo vem preenchido.
- **Visibilidade:** o gestor vê "afastado de D1 a D2", **sem CID e sem arquivo**.
- Quando o colaborador entra em afastamento, `employees.status` pode ir a `on_leave`; ao fim volta a `active`.

### G8 · Banco de horas (MVP)

**Tabelas:**
- `time_bank_policies` (`company_id`, `scope` = `individual`|`collective`, `compensation_months` 6 ou 12, vigência)
- `time_bank_enrollments` (`employee_id`, `policy_id`, vigência)
- `time_bank_entries` (**ledger só INSERT**): `employee_id`, `entry_date`, `kind` = `credit`|`debit`|`compensation`|`payout`|`discount`|`adjustment`, `minutes` (com sinal, ≠ 0), `expires_date`, `source_kind` = `timesheet`|`compensatory_leave`|`expiry`|`manual`, `source_key` (idempotência), `reversal_of_id`, `note`, `created_by_id`. `UNIQUE (tenant_id, employee_id, source_key)`
- `compensatory_leaves` (`employee_id`, `leave_date`, `minutes`, `status`, fluxo de aprovação)

**Endpoints:** `GET /time-bank/balances?departmentId` · `GET /time-bank/employees/:id/statement` (saldo e extrato) · `POST /time-bank/employees/:id/entries` (lançamento manual, com motivo) · `POST /compensatory-leaves` + `approve|reject` · `/time-bank-policies`.

**Regras:**
- **Regra individual (6 meses) ou coletiva (1 ano):** é a janela em que o crédito precisa ser compensado (CLT art. 59, §§ 2º e 5º) **[A CONFIRMAR]**. Cada crédito nasce com `expires_date`.
- **Saldo é derivado** (`SUM(minutes)`), nunca coluna. **Crédito é consumido por ordem de vencimento (FIFO)**; função pura calcula o que vence em N dias.
- **Origem automática:** a apuração (G4) grava crédito/débito do dia. Como o ledger não se altera, **recalcular um dia grava a diferença** com `source_key = timesheet:{work_date}:v{calc_version}`.
- **Folga compensatória:** ao aprovar, grava débito e marca o dia como `compensated` na apuração.
- **Alerta de saldo alto ou vencendo:** job diário `check-deadlines` (`high_balance_minutes`, `expiry_alert_days`). No MVP aparece nas "Pendências" do painel (G11); na fase 2, vira aviso (E6).
- **Pagamento ou desconto no vencimento:** job grava `payout` (crédito vencido vira hora extra paga) ou `discount` (saldo negativo vencido). **Desconto de saldo negativo é restrito pela lei trabalhista: só com previsão em acordo [A CONFIRMAR]**; começa desligado e exige parametrização.

### G9 · Férias (Fase 2)

**Tabelas:** `vacation_periods` (`employee_id`, `acquisition_start_date`, `acquisition_end_date`, `concession_end_date`, `entitled_days`, `sold_days`, `status`) · `vacation_installments` (`period_id`, `start_date`, `end_date`, `days`, `status`, fluxo de aprovação).

**Endpoints:** `GET /vacations/periods?employeeId` · `POST /vacations/requests` + `approve|reject|cancel` · `GET /vacations/calendar` (mapa da equipe) · `GET /vacations/expiring`.

**Regras (todas **[A CONFIRMAR]** com o jurídico):**
- **Período aquisitivo** de 12 meses a partir da admissão; **concessivo** nos 12 seguintes.
- **Dias de direito conforme faltas injustificadas** (CLT art. 130): até 5 faltas, 30 dias; 6 a 14, 24; 15 a 23, 18; 24 a 32, 12; acima de 32, perde o direito. As faltas vêm da apuração (G4).
- **Fracionamento em até 3 períodos** (um com ao menos 14 dias, os demais com ao menos 5). **Venda de 1/3** (abono pecuniário, até 10 dias). Não pode **iniciar** nos dois dias que antecedem feriado ou descanso semanal.
- **Alerta de férias vencendo:** concessivo acabando sem agendamento (risco de pagamento em dobro).
- Férias aprovadas viram `absences` com `kind = vacation`, então a apuração (G4) e o painel (G11) já as tratam. **O `kind = vacation` fica reservado no MVP** para não exigir migration depois.
- Pagamento (até 2 dias antes do início) entra na exportação para a folha (G12).

### G10 · Fechamento e espelho (MVP / Fase 2)

O quadro marca o módulo como "MVP / Fase 2" sem dividir. **Hipótese [A CONFIRMAR]:** MVP = espelho da equipe, fechamento e reabertura; fase 2 = pedido do AEJ ao fechar.

**Tabelas:**
- `closing_periods` (`company_id`, `start_date`, `end_date`, `status` = `open`|`closed`|`reopened`)
- `closing_period_events` (**só INSERT**): `closing_id`, `kind` = `closed`|`reopened`, `reason`, `actor_id`, `created_at`. Histórico completo de fechar e reabrir
- `closing_snapshots` (um por colaborador ao fechar): totais do período + `data_hash` (SHA-256 do conteúdo canônico). **Imutável**, prova do que foi fechado
- `time_mirrors` (`employee_id`, `closing_id`, `file_key`, `file_sha256`, `generated_at`, `version`)
- `aej_exports` (`closing_id`, `file_key`, `signature_key`, `requested_by_id`, `generated_at`)
- `mirror_acknowledgements`: ver E1

**Endpoints:** `GET /closings` · `POST /closings` (abre período) · `POST /closings/:id/close` · `POST /closings/:id/reopen` (**só `admin`, com `reason`**) · `GET /closings/:id/mirrors` (espelho de ponto **da equipe**) · `POST /closings/:id/aej` (pede o AEJ) · `GET /employees/:id/mirror?month=`.

**Regras:**
- **Antes de fechar**, o sistema lista pendências do período: pedidos de ajuste em aberto (G5), atestados em análise (G6/G7), dias `inconsistent` (G4). O RH pode fechar mesmo assim, **informando o motivo**, que fica no evento.
- **Ao fechar:** calcula o DSR, congela `closing_snapshots`, marca os dias como `closed` e dispara `generate-mirror`.
- **Espelho (art. 84 da Portaria):** empregador; colaborador (nome, CPF, admissão, cargo); período; horário contratual; marcações **originais e tratadas**; duração das jornadas, com hora noturna reduzida. Gerado em PDF e guardado no S3; o colaborador acessa no mês seguinte, no mínimo.
- **Reabertura:** só RH, com motivo, evento `critical` na auditoria. Depois dela, os dias voltam a ser recalculáveis e o colaborador precisa de **nova ciência**.
- **Batida offline tardia em período fechado** não altera nada; gera `timesheet.late_punch_detected` (alerta ao RH).
- **AEJ:** o `signer` gera e assina (CAdES `.p7s`). O leiaute vigente precisa ser conferido no gov.br **[A CONFIRMAR]** (`02` §10, item 3).

### G11 · Painel do dia e indicadores (MVP)

**Sem tabela nova.** Só leitura, com escopo (gestor: equipe; RH: empresa).

**Endpoints:** `GET /dashboard/today?establishmentId&departmentId` (presentes, ausentes e atrasados) · `GET /dashboard/pending` (pendências de aprovação: ajustes, atestados, férias) · `GET /dashboard/indicators?month` (extras, faltas, saldo do banco) · `GET /dashboard/away` (quem está de férias ou afastado).

**Regras:**
- **Hoje** ainda não tem `daily_timesheets` fechado: o painel combina **marcações do dia lidas do ARP** com a **escala esperada** (quem já deveria ter entrado) e os afastamentos. Cache curto no Valkey (15 a 30 s). **Tempo real por SSE** é opcional (a Visage já usa).
- **Indicadores do mês** agregam `daily_timesheets` (SQL; *materialized view* só se ficar lento).
- Nenhum dado de saúde aparece aqui: afastamento sem CID.

### G12 · Relatórios e exportação (Fase 2)

**Tabelas:** `report_jobs` (`kind`, `params JSONB`, `format` = `pdf`|`xlsx`|`csv`, `status`, `file_key`, `requested_by_id`, `expires_at`) · `payroll_event_codes` (mapa de evento do Genus, como `overtime`, `night_additional`, `absence`, `time_bank_payout`, para a verba da folha do cliente) · `payroll_exports` (`closing_id`, `layout`, `file_key`, `generated_at`).

**Endpoints:** `POST /reports` (cria o job) · `GET /reports/:id` e `/file` · `GET /payroll-exports` · `POST /closings/:id/payroll-export` · `GET /audit-logs` (trilha de alterações, sobre o `audit_logs`).

**Regras:**
- Relatório é **job assíncrono** (PDF e Excel); o arquivo vai ao S3 e expira. Gestor só gera da equipe.
- **Exportação para a folha:** a saída depende do sistema do contador (Domínio, Alterdata, Senior, TOTVS e outros). **Proposta:** começar com um **CSV genérico** com o mapeamento `payroll_event_codes`, e acrescentar layouts específicos sob demanda. **[A DECIDIR]** quais sistemas (§9, item 8).
- **Trilha de auditoria de alterações** é uma tela sobre `audit_logs` (já existe como padrão); admin vê só o próprio tenant.
- **Avisos por e-mail ou WhatsApp:** ver E6.

---

## 4. Painel do funcionário (celular)

O painel do colaborador é uma **área responsiva do portal Next.js (`/me`), instalável como PWA**. **[A DECIDIR]** (§9, item 2). Todos os endpoints são `/me/*` e **ignoram qualquer `employeeId` recebido**: usam o do login. **O painel não registra ponto** (o ponto continua nos coletores), o que respeita o ponto de `01` §2: a empresa não pode obrigar o funcionário a usar o celular pessoal para bater ponto.

| # | Módulo | Fase | Endpoints | Reusa |
|---|---|---|---|---|
| E1 | **Meu ponto** | MVP | `GET /me/timesheets/today` · `GET /me/timesheets?month` (espelho do mês) · `GET /me/punches/:id/receipt` (comprovante PDF) · `POST /me/mirrors/:id/acknowledge` | G4, G10, `gerar_pdf` (já existe) |
| E2 | **Meus pedidos** | MVP | `GET|POST /me/adjustment-requests` · `POST /me/adjustment-requests/:id/cancel` | G5 |
| E3 | **Meus atestados** | MVP | `POST /me/certificates/uploads` (URL assinada) · `POST /me/certificates/:id/complete` · `GET /me/certificates` (status e **motivo**; sem CID) | G6, G7 |
| E4 | **Meu banco de horas** | MVP | `GET /me/time-bank` (saldo) · `GET /me/time-bank/entries` (extrato) · vencimentos | G8 |
| E5 | **Minhas férias** | Fase 2 | `GET /me/vacations` (dias disponíveis, próximas) · `POST /me/vacations/requests` | G9 |
| E6 | **Avisos** | Fase 2 | `GET /me/notifications` · `POST /me/notifications/:id/read` · `PUT /me/notification-preferences` | `notifications` |

- **E1, ciência no espelho fechado:** `mirror_acknowledgements` (`employee_id`, `mirror_id`, `kind` = `acknowledged`|`contested`, `acknowledged_at`, `ip_address`, `user_agent`, `note`). Contestar abre um pedido de ajuste (G5). Reabrir o período invalida a ciência.
- **E1, comprovantes:** o PDF assinado de cada batida já é gerado pelo job existente; o painel só lista e serve por URL assinada (mínimo das últimas 48 h, `01` §3.5; todos ficam guardados).
- **E3, upload:** direto para o S3 por URL assinada de PUT (câmera ou arquivo), depois `complete`. A API valida tipo e tamanho e dispara `analyze-certificate`. O colaborador **nunca** vê o CID nem a nota de risco: só o status e o motivo da decisão.
- **E6, avisos** (`notifications`: `recipient_user_id`, `kind`, `channel` = `in_app`|`email`|`whatsapp`|`push`, `payload JSONB`, `status`, `sent_at`, `read_at`): eventos como pedido decidido, férias ou banco perto de vencer e espelho pronto para ciência. O worker `send-notification` escolhe o canal pela preferência. **WhatsApp tem custo por mensagem**: só avisos prioritários, com *opt-in*, como já avisado em `03` §4.
- **Login do colaborador:** não está no quadro e é pré-requisito do painel (§8 e §9, item 3).

---

## 5. Integrações externas

| Necessidade | Módulo | Opções | Recomendação | Estado |
|---|---|---|---|---|
| **OCR de atestado** | G6 | (a) **local**: Tesseract ou PaddleOCR no worker Python. (b) **nuvem**: Google Document AI/Vision, AWS Textract, Azure | **(a)**: dado de saúde não sai da infraestrutura e dispensa operador adicional. Qualidade menor em foto de celular, compensada por pré-processamento e porque **o RH decide**. (b) só com contrato de operador e avaliação de transferência internacional | **[A DECIDIR]** |
| Armazenamento | G6, G10, G12, E3 | S3 ou compatível | Já previsto (`02` §4.5) | Decidido |
| Assinatura de PDF/AEJ | G10 | `signer` (pyHanko), interno | Já previsto | Decidido |
| Geração de PDF (espelho, relatórios) | G10, G12 | Composição em Node (pdfkit ou Playwright) + assinatura no `signer` | Node compõe, `signer` assina | **[A DECIDIR]** biblioteca |
| Excel | G12 | `exceljs` | — | Decidido |
| E-mail transacional | G12, E6 | Amazon SES, Resend, Brevo ou SMTP | Qualquer provedor atrás de uma interface `Mailer` | **[A DECIDIR]** |
| WhatsApp | G12, E6 | WhatsApp Business Platform (Meta Cloud API, direta ou por BSP) | Só avisos prioritários; custo por mensagem; *opt-in* | **[A DECIDIR]** |
| Push | E6 | Web Push (VAPID), sem custo | Para o PWA | Fase 2 |
| Folha de pagamento | G12 | Layout por sistema do contador | CSV genérico + mapeamento de verbas; layouts sob demanda | **[A DECIDIR]** quais |
| Feriados | G3 | Nenhuma: cálculo local. BrasilAPI só para conferência opcional | Cálculo local | Decidido |
| Validação de CRM | G6 | Apenas formato (UF + número) | Sem consulta externa; **[A CONFIRMAR]** se existe API oficial utilizável | Decidido (formato) |
| Hora legal | G4 | `chrony` com `ntp.on.br` | Já previsto (`02` §7) | Decidido |

---

## 6. Jobs e filas novos

Complementam `03` §8. Nomes em inglês (`database.md` §12). Todos idempotentes, com `jobId` determinístico (`backend.md` §8).

| Fila / job | Gatilho | O que faz |
|---|---|---|
| `recalculate-day` | Evento (marcação, pedido, afastamento, escala, feriado) | Recalcula o dia (G4), grava o diferencial do banco (G8). **É o `calcular_jornada` de `03`** |
| `analyze-certificate` | Upload concluído (E3) | OCR, regras e nota de risco (G6) |
| `generate-mirror` | Fechamento (G10) | Espelho em PDF por colaborador. **É o `espelho_mensal` de `03`** |
| `generate-aej` | Pedido do RH (G10) | AEJ e `.p7s` pelo `signer` |
| `seed-holidays` | Anual e sob demanda | Feriados nacionais do ano (G3) |
| `check-deadlines` | Diário | Banco vencendo/alto, férias vencendo, afastamento acima de 15 dias, vencimento de crédito (`payout`) |
| `send-notification` | Evento (fase 2) | E-mail, WhatsApp, push, in-app (E6) |
| `generate-report` | Pedido do usuário (fase 2) | PDF/Excel e exportação para a folha (G12) |
| `purge-certificates` | Diário | Aplica a retenção de atestados **[A CONFIRMAR]** |

---

## 7. Permissões e auditoria

### 7.1 Matriz (resumo)

| Módulo | `admin` (RH) | `manager` (equipe) | `employee` |
|---|---|---|---|
| G1 Cadastros | CRUD | Ler equipe, **sem salário** | – |
| G2 Escalas | CRUD, regras | Ver calendário; criar troca pontual | Ver a própria |
| G3 Feriados | CRUD | Ler | – |
| G4 Apuração | Tudo, recalcular | Ler equipe | Própria |
| G5 Ajustes | Decidir, criar abono | **Decidir pedidos da equipe** | Criar e acompanhar os próprios |
| G6 Análise de atestado | Tudo | **Nada** | – |
| G7 Atestados e afastamentos | Decidir; ver CID | Vê "afastado", sem CID e sem arquivo | Envia; vê status e motivo |
| G8 Banco de horas | Tudo | Ler equipe | Próprio |
| G9 Férias | Tudo | Decidir equipe | Próprias |
| G10 Fechamento | Fechar, **reabrir** | Ver espelho da equipe | Ver e dar ciência no próprio |
| G11 Painel | Empresa | Equipe | – |
| G12 Relatórios | Tudo | Da equipe | – |

### 7.2 Eventos de auditoria novos (catálogo em `lib/audit-events.ts`)

`employee.created|changed|terminated` · `schedule.assigned` · `schedule_override.created` · `workweek_rule.changed` · `holiday.created|changed` · `adjustment.requested|approved|rejected|canceled` · `time_waiver.granted` · `certificate.submitted|analyzed|approved|rejected` · **`certificate.viewed`**, **`certificate.file_downloaded`** (leitura de dado de saúde) · `absence.created|ended` · `time_bank.entry_created|policy_changed` · `compensatory_leave.requested|approved` · `closing.closed` · **`closing.reopened` (severity `critical`)** · `mirror.acknowledged|contested` · `aej.generated` · `payroll_export.generated` · `timesheet.recalculated` · `timesheet.late_punch_detected`.

---

## 8. Ordem de construção e corte para 25/11

O MVP do quadro é grande para a data. Esta é a ordem pela **cadeia de dependência**, com o que cortar primeiro se apertar. A decisão de corte é sua.

**Fundação (fora do quadro, mas pré-requisito de tudo):** projeto `apps/api` (Fastify, `env`, erros, Pino, OpenAPI) · autenticação, papéis e escopo de equipe · convite e primeiro acesso do colaborador · `request-context`, auditoria e `redactDiff` · cliente S3 e URL assinada · outbox e filas · `ArpReader` (leitura do ARP) · `company_settings` · *seeds* (feriados nacionais, `leave_types`, regra legal de jornada) · **importação em massa de colaboradores (CSV)**, que não está no quadro mas torna o onboarding viável.

**Trilha crítica:**

```
Fundação → G1 Cadastros → G2 Escalas ─┐
                          G3 Feriados ─┴→ G4 Apuração ─┬→ G5 Ajustes ───────┐
                                                        ├→ G7 Afastamentos ──┤
                                                        │   └─ G6 Atestados  ├→ G10 Fechamento → G11 Painel
                                                        └→ G8 Banco de horas ┘
Painel do funcionário (E1–E4): cada tela entra assim que o módulo G correspondente existe
```

| Ordem | O que | Por quê |
|---|---|---|
| 1 | Fundação + **G1, G2, G3** | Quase só CRUD; destravam a apuração. G2 e G3 correm em paralelo |
| 2 | **G4 Apuração** | **O item mais arriscado do MVP**: regra trabalhista, testes por tabela de casos, parâmetros por empresa |
| 3 | **G5, G7** | Alimentam a apuração. G7 sem análise automática já entrega valor |
| 4 | **G8 Banco de horas** | Depende da apuração (créditos) |
| 5 | **G10 Fechamento** (espelho e fechar/reabrir) | Fecha o ciclo do mês |
| 6 | **G11 Painel** | Só leitura; vem depois que existem dados |
| 7 | **E1–E4** | Camada fina sobre os módulos acima |
| 8 | **G6 Análise heurística** | Maior incerteza técnica (OCR); **candidata natural a corte** |

**Cortes sugeridos, do menos ao mais doloroso:**
1. **G6 entra só como fila manual.** G7 já recebe o atestado, o RH decide e a análise automática vem depois. A tabela `certificate_analyses` e o `findings` já ficam no schema.
2. **G10 sem PDF assinado:** espelho em tela e fechamento, deixando o PDF e o AEJ para a fase 2.
3. **G11 só com "hoje" e "pendências"**, deixando os indicadores do mês para depois.
4. Menos corte possível em **G4**: sem ela o resto não tem sobre o que operar.

---

## 9. Decisões em aberto

| # | Decisão | Recomendação |
|---|---|---|
| 1 | **OCR de atestado:** local ou nuvem | Local (§5) |
| 2 | **Painel do funcionário:** PWA no portal ou app Expo | PWA no Next.js: reaproveita a API e dispensa publicação em loja para 25/11 |
| 3 | **Login do colaborador:** CPF + senha, link por e-mail/WhatsApp ou código | Convite por e-mail + senha; WhatsApp só na fase 2 |
| 4 | **Escopo do gestor:** só diretos ou toda a hierarquia | Diretos no MVP |
| 5 | **Base facial "existente":** onde moram os embeddings e como `employees` se liga | Definir antes de G1: banco `app` do Genus (importando da Visage) ou leitura cruzada |
| 6 | **Fechamento:** por empresa ou por estabelecimento; "AEJ ao fechar" é MVP ou fase 2 | Por empresa; AEJ na fase 2 |
| 7 | **Parâmetros trabalhistas** (tolerância, noturno, extras, DSR, banco, feriado trabalhado) | Parametrizar por empresa; validar os padrões com o contador e com a convenção coletiva do cliente |
| 8 | **Folha:** quais sistemas exportar | CSV genérico primeiro; layouts por demanda |
| 9 | **Retenção** de atestados e de biometria; base legal | Parecer jurídico (`01` §6) |
| 10 | **CPF em claro ou cifrado** (conflito com `02` §8) | Em claro; cifrar só saúde e biometria (`database.md` §10) |
| 11 | **Row-Level Security** como segunda barreira de tenant | Avaliar após o MVP |
| 12 | **Better Auth × multi-tenant e `session_id` da auditoria** | Validar na fundação |
| 13 | **Biblioteca de PDF** (pdfkit ou Playwright) | Escolher no primeiro espelho |
| 14 | **Convenção coletiva:** o cliente pode ter regras que mudam os parâmetros | Suportar `workweek_rules.source = agreement` e parâmetros por empresa desde o início |
