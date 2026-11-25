# Mapa do front do portal (RH e funcionário)

Levantamento de 24/11/2026 sobre `apps/portal`, `apps/api` e o design em `Genus_ interface RH e portal/`. Serve de base para o prompt do orquestrador. **Fontes:** rotas e schemas Zod de `apps/api/src/modules/*`, `docs/architecture/04-funcionalidades-rh.md`, os quatro `.dc.html` do design.

> **Estado em 24/11/2026:** todas as telas deste mapa foram entregues em `apps/portal` (seções 4.0 a 4.13 e 5), mais a aba **Totens** (`/rh/totens`). O que depende de endpoint inexistente roda em mock (`NEXT_PUBLIC_USE_MOCKS=true`) e está em `docs/portal-endpoints-pendentes.md`. Relatórios e Configurações são prévias (gerar/salvar desabilitados). Telas `[SEM DESIGN]`: login, colaboradores (lista), escalas, ajustes, banco de horas, fechamento, relatórios, configurações, totens. Pendências de verificação: §7.

Legenda de integração: **API** = existe no back · **MOCK** = não existe, vai para mock atrás de `NEXT_PUBLIC_USE_MOCKS` e entra na lista de pendências do back · **DERIVADO** = o front monta a partir de endpoints que existem.

---

## 1. Regras do trabalho (valem para todo agente)

- Escopo: só `apps/portal` (+ docs). Não mexer em face-engine, collector-api, rep-core, signer, jobs, fila, tabelas do `arp`. **Não criar migration nem alterar rota do back**: o que faltar vira mock e entra na seção 6.
- Tudo na `main`, sem commit sem pedido. Não commitar `postman/fixtures/not-an-image.png` nem `out/`.
- Idioma: UI e mensagens em pt-BR; código, rotas, chaves de JSON em inglês; valores de enumeração do back **não se traduzem** (`"status": "pendente"`).
- **Portaria 671:** nenhuma tela edita ou apaga uma marcação. O RH só acrescenta (ajuste, abono, justificativa). Duplicidade/horário/cerca só sinalizam, nunca bloqueiam.
- **LGPD:** CID e arquivo do atestado só para `rh` (`can(role,'certificate.viewCid')`). Admin e gestor veem "afastado", e o admin vê `Dado sensível restrito` (componente `CidValue`). Nunca CID, texto de OCR ou nota de risco para o colaborador. Nada disso em `console`, URL, `localStorage` ou log.
- `tenantId` nunca vem do front; o `employeeId` do portal do funcionário é sempre o da sessão (a API ignora o que for enviado).
- Cálculo de jornada, KPIs, saldos e totais **não se calculam no front**: a API manda pronto. O front só formata (minutos → `HH:mm`).
- Erro 5xx sempre vira mensagem genérica (já feito em `lib/api/client.ts`). 403 e 404 têm tela própria.
- Acessibilidade: contraste 4,5:1, foco visível, navegação por teclado, `aria-live` nos toasts, tabelas com cabeçalho semântico. Cada tela com teste Vitest + `vitest-axe`.

## 2. O que já existe em `apps/portal`

Next.js 15, React 19, Tailwind 4, Manrope, Phosphor, Better Auth (cookie httpOnly), proxy de `/portal`, `/auth`, `/me` para `API_URL`.

| Peça | Arquivo |
|---|---|
| Tokens (`brand`, `ink`, `muted`, `line`, `surface`, `tint`, `warn`, `danger`, raios, sombras) | `src/app/globals.css` |
| Cliente HTTP, `ApiError` (`validation`, `forbidden`, `conflict`, `server`, `network`…) | `src/lib/api/client.ts`, `errors.ts` |
| Tipos, chamadas, mocks (só `me`, `establishments`, `overview`) | `contracts.ts`, `rh.ts`, `mocks.ts` |
| `can(role, action)` (4 ações: `rh.panel`, `certificate.viewCid`, `certificate.approve`, `employee.portal`) | `src/lib/auth/permissions.ts` |
| Sessão (me, api, estabelecimento selecionado) e `useResource` (loading/error/success + "Tentar de novo") | `session.tsx`, `use-resource.ts` |
| `Button`, `Card`, `KpiCard`, `AlertCard`, `CidValue`, Skeleton/Loading/Empty/Error/Forbidden | `src/components/ui/` |
| Shell (sidebar recolhível, seletor de estabelecimento, header com período e ação primária) | `components/shell/Shell.tsx` |
| Tela pronta: Visão geral | `features/overview/OverviewContent.tsx`, rota `/rh` |

**Lacunas da base:** só existe a rota `/rh` (sem roteamento por tela); sem tela de login; sem rota `/me` do funcionário; sem componentes de tabela, abas, painel lateral (drawer), modal/diálogo de confirmação, toast, campo de formulário, seletor de período, badge de status, barra de progresso, calendário/Gantt, linha do tempo de marcações; header com período e ação primária só visuais; sidebar sem navegação real; `can()` não cobre as demais ações; `contracts.ts` não tem os tipos das rotas reais.

## 3. Mapa de navegação

Menu do design (`NAV`), com o que cada item vira:

| Item | Rota proposta | Design | Back | Fase |
|---|---|---|---|---|
| Visão geral | `/rh` | pronto | KPIs/alertas **MOCK** | MVP |
| Colaboradores | `/rh/colaboradores` e `/rh/colaboradores/[id]` (espelho) | só espelho | CRUD **API** | MVP |
| Escala e apuração | `/rh/apuracao` | desenhado | dia inteiro **MOCK**, por colaborador **API** | MVP |
| Ajustes | `/rh/ajustes` | **sem design** | **API** | MVP |
| Férias | `/rh/ferias` | desenhado | por colaborador **API**, calendário por setor **MOCK** | Fase 2 |
| Atestados | `/rh/atestados` | desenhado | **API** | MVP |
| Banco de horas | `/rh/banco-horas` | **sem design** | RH sem rota (só `/me/time-bank`) | MVP |
| Fechamento | `/rh/fechamento` | **sem design** | **API** | MVP/Fase 2 |
| Relatórios | `/rh/relatorios` | **sem design** | **sem back** | Fase 2 |
| Configurações | `/rh/configuracoes` | **sem design** | **sem back** | Fase 2 |
| (fora do menu) Escalas | `/rh/escalas` | **sem design** | **API** | MVP |
| (fora do menu) Login | `/login` | **sem design** | Better Auth **API** | MVP |
| Portal do funcionário | `/me`, `/me/espelho`, `/me/ferias`, `/me/atestado` | desenhado (4 abas) | **API** (`/portal/me/*`) | MVP |

Telas **sem design**: seguir os tokens e os componentes das telas desenhadas; o orquestrador deve marcá-las `[SEM DESIGN]` no PR e usar o padrão tabela + filtros + painel lateral das telas de Apuração e Atestados.

Papéis que entram no painel: `rh`, `admin`, `gestor` (só com `PORTAL_GESTOR_ENABLED`), `contador` (só fechamento e exportação). `super_admin` não entra nos módulos de RH. `colaborador` só vê `/me`. Redirecionar por papel após o login.

## 4. Telas do painel de RH

Para cada tela: **dados** (fonte), **estado que a tela guarda**, **ações**, **estados de UI**, **permissões**, **lacunas**. Estado na URL (query string) sempre que for filtro ou seleção que o usuário queira compartilhar/recarregar; estado só em memória para rascunho e UI transitória. **Nunca** persistir em `localStorage`: dado de saúde, CPF completo, e-mail de colaborador. Só preferências de UI (sidebar recolhida, último estabelecimento) podem ir para `localStorage`.

### 4.0 Login e sessão
- **Dados:** `POST /auth/sign-in/email` (e-mail + senha → cookie, ou `{ twoFactorRedirect }`), `POST /auth/two-factor/verify-totp`, `POST /auth/sign-out`, `GET /me`.
- **Guarda:** rascunho do formulário (só em memória; senha nunca fora do campo), etapa (senha ou TOTP), contador de erro.
- **Estados:** erro de credencial genérico (não revela se o e-mail existe), conta bloqueada por tentativas, 2FA obrigatório (`mfaEnabled=false` do `super_admin` só ativa o 2FA), sessão expirada (volta ao login mantendo a rota de destino).
- **Lacunas:** sem design; sem recuperação de senha nem convite (dependem de e-mail, ver seção 6); login do colaborador ainda é pendência do back (§9 item 3 do doc 04) — o portal do funcionário só funciona para usuário `colaborador` já criado.

### 4.1 Visão geral (feita) — `/rh`
- **Dados:** `GET /portal/overview?establishmentId=` (**MOCK**): 5 KPIs (`workedHours`, `overtimeHours`, `absences`, `pendingCertificates`, `activeVacations`) e alertas (`alerta`|`sinal`, com `target`). Gráfico "Horas extras por dia" e comparativo: **sem endpoint, não calcular no front** (seção do design fica com estado "indisponível" ou mock explícito).
- **Guarda:** estabelecimento selecionado (sessão), período.
- **Ações:** cada alerta navega para Apuração/Escalas já filtrada (`?status=inconsistente&setor=`); ação primária do header "Revisar inconsistências" leva à Apuração filtrada.
- **A fazer:** ligar período e ação primária do header; navegação real da sidebar.

### 4.2 Colaboradores — lista, cadastro e espelho individual
- **Lista** (sem design): `GET /portal/employees?establishmentId&status&page&pageSize` → `{ data, meta }`. Campos: `id, name, cpf (mascarado, exceto rh/admin), registrationNumber, admissionDate, terminationDate, managerId, status`. **Não traz setor, cargo, escala nem foto**: setor/cargo vêm de `GET /employees/:id/assignments` (só ids: `departmentId`, `jobTitleId`, `costCenterId`), e **não existe endpoint de setores, cargos ou centros de custo** (**MOCK** + pendência do back). Busca por nome/matrícula: a API não filtra por texto → filtrar na página corrente no front e registrar a lacuna.
- **Cadastro/edição** (rh): `POST /employees` (`establishmentId, cpf, name, registrationNumber?, birthDate, admissionDate, managerId?`) devolve `initialPin` **mostrado uma única vez** (modal que exige confirmação; nunca guardar). `PATCH /employees/:id` (nome, matrícula, nascimento, gestor; CPF e estabelecimento não mudam). `POST /employees/:id/terminate` (data + motivo). Vínculos: `GET|POST /employees/:id/assignments`, `PATCH …/:assignmentId` (cargo, setor, centro de custo, `contractType` ∈ indeterminado/determinado/safra/intermitente, salário só rh/admin, vigência). Cadastro facial: `POST /facial/enrollments` (multipart, consentimento + 1–5 fotos) e `POST /facial/status` — **dado biométrico: fora do front de RH até decisão de produto** (hoje é fluxo do totem).
- **Guarda:** filtros (`establishmentId`, `status`, `page`) na URL; rascunho do formulário em memória; mapa de erros por campo vindo do 422.
- **Estados:** vazio ("nenhum colaborador"), 409 (CPF duplicado), 422 por campo, 403 (gestor sem escopo → 404 da API, tratar como "não encontrado").
- **Permissões:** criar/editar/desligar só `rh`; admin e contador leem; gestor lê só a equipe e **sem salário**; CPF completo só rh/admin.

### 4.3 Espelho do colaborador (desenhada) — `/rh/colaboradores/[id]`
- **Dados:** `GET /portal/employees/:id/timesheets?from&to` (dias com `situation`, `status` calculada|inconsistente, minutos previstos/trabalhados/falta/atraso/extras 50% e 100%/noturno/intervalo, `punches[]` com `origin` original|tratada e `nsr`, `issues[]`, `parameterVersion`). Totais do período e saldo do banco: **DERIVADO** de `GET /closings/:id/mirrors/:employeeId` quando houver fechamento (traz `totals`, `timeBank`, `acknowledgedAt`, `pdfUrl` = nulo hoje); para período aberto, somar os dias no front **só para exibição** (soma simples dos minutos que a API entregou, sem regra trabalhista).
- **Guarda:** `from`/`to` na URL; dia selecionado; filtro de status.
- **Ações:** "Gerar espelho em PDF" (`pdfUrl` ainda nulo → botão desabilitado com explicação); "Recalcular" (`POST /employees/:id/timesheets/recalculate`, só rh, mostra `skipped` com `sem_escala`); abrir **ajuste** do dia (4.5); marcações tratadas aparecem **acrescentadas**, a original nunca é substituída visualmente (badge "Ajustada · saída incluída por ajuste aprovado").
- **Estados:** período sem marcações; dia `inconsistente` com a lista de `issues` traduzida (tabela de rótulos para os 8 tipos: `batida_faltando`, `batidas_impares`, `interjornada_menor_11h`, `extra_acima_2h`, `intervalo_nao_cumprido`, `marcacao_duplicada`, `marcacao_fora_de_ordem`, `marcacao_fora_da_escala`); `resolved=true` marcado como resolvido.

### 4.4 Apuração do dia (desenhada) — `/rh/apuracao`
- **Dados:** a lista do dia de **todos** os colaboradores **não existe** → **MOCK** + pendência do back. Hoje só `GET /employees/:id/timesheets`. Alternativa de transição já viável, mas cara (N chamadas): não usar em produção; manter o contrato `DayRow[]` do mock igual ao que o back deve entregar (colaborador, matrícula, setor, cargo, marcações, previsto, trabalhado, extra, falta, status, motivo).
- **Guarda (na URL):** data, `establishmentId`, setor, aba de status (`todos|inconsistente|falta|calculada`), busca; paginação.
- **Layout:** abas com contagem, filtro por setor, busca, tabela com marcações como chips (par ímpar → chip tracejado "sem saída"), colunas Trabalhado/Extra/Falta (extra > 2 h destacado), status com ícone, rodapé "N colaboradores · M inconsistências para revisar antes do fechamento". Clique na linha → espelho do colaborador.
- **Ações:** "Recalcular dia" (rh; toast "As marcações originais não mudam"); filtrar por alerta vindo da visão geral.
- **Estados:** loading (skeleton de 6 linhas), vazio ("Nenhuma marcação em 21/11" + CTA "Ver escala do dia"), erro com retry, 403.

### 4.5 Ajustes (SEM DESIGN) — `/rh/ajustes`
- **Dados:** `GET /adjustments?status&employeeId&page` (`id, employeeId, date, type` ∈ inclusao_batida/justificativa/abono, `proposedAt`, `reason`, `status` pendente/aprovado/recusado, solicitante, decisor, `decisionReason`). Aprovar: `POST /adjustments/:id/approve` (`note?`); recusar: `POST …/reject` (`reason` obrigatório). Criar pelo RH: `POST /employees/:id/adjustments` (`date, type, proposedAt` só na inclusão, `reason`).
- **Regras:** abono só rh decide; admin não decide; gestor decide só a equipe; aprovar **nunca altera a marcação original**, só acrescenta (mostrar "marcação original" e "proposta" lado a lado); justificativa de recusa obrigatória.
- **Guarda:** filtros na URL; item selecionado no painel lateral; rascunho do motivo.
- **Ligação:** aprovado → dia recalculado; a tela deve invalidar o espelho/apuração do dia.
- **Nomes dos colaboradores:** a lista só traz `employeeId` → resolver via cache de `GET /employees` (por estabelecimento) no front.

### 4.6 Atestados (desenhada) — `/rh/atestados`  **← primeiro item do handoff**
- **Dados:** `GET /certificates?status&employeeId&page` (RH: + `doctorName, doctorCrm, doctorCrmUf, decisionReason, fileUrl`; admin/gestor: sem médico, sem arquivo). Arquivo: `GET /certificates/:id/file` (download **auditado**, só rh; abrir em nova aba/blob, nunca guardar). Análise: `POST /certificates/:id/analyze` (`text` 20–20.000 caracteres, `models?` até 4; **só sugere, não muda o status**) e `GET /certificates/:id/analyses`. Decidir: `POST …/approve` e `POST …/reject` (`reason`).
- **Análise (campos para o painel):** `recommendation`, `risk {score 0–100, level baixo|medio|alto, findings[{code,severity alta|media|baixa,message}]}`, `reliability {score, band, cap}`, `checkedFields[{item,status,evidence}]` (paciente, data de emissão, afastamento, médico, CRM, assinatura), `cid[]` (**só rh**), `warnings`, `notice` (**sempre exibir**: a análise é indicativa e não comprova autenticidade), `ai.status` concluida|nao_executada|falhou, `comparison` quando 2+ modelos.
- **Mapeamento design → API:** "Recebido / Em análise / Decidido" do design **não são status do back** (`pendente|aprovado|recusado`). `Recebido` = pendente sem análise; `Em análise` = pendente com análise; `Decidido` = aprovado/recusado. Nome, matrícula e setor vêm do cache de colaboradores (a lista só traz `employeeId`). "Nota" 0–100 = `risk.score`. "Enviado no prazo" etc. = `findings`.
- **Layout:** fila à esquerda (abas com contagem, cartão com avatar, setor, período, badge de status e de risco) e painel lateral com campos conferidos (ícone ok/atenção + observação), CID (`CidValue`), arquivo, barra de risco, achados (`alerta`|`sinal`) e decisão. Ação primária "Abrir próximo da fila".
- **Guarda:** aba e item selecionado na URL (`?aba=&id=`); texto colado para análise (em memória, **limpar ao fechar o painel e ao trocar de item**, nunca em storage); modelos escolhidos.
- **Ações e regras:** `can(role,'certificate.approve')` → só rh vê Aprovar/Recusar; admin vê "Aguardando decisão do RH" e `Dado sensível restrito`; recusa exige motivo e confirmação; aprovar cria afastamento e dispara recálculo (toast "Os dias serão recalculados"); decidido é imutável (botões somem, mostra "Aprovado em … por …").
- **Estados:** "lendo atestado" (análise em curso), análise falhou (`ai.status=falhou` → mostrar só as regras), fila vazia com CTA "Ver decididos", 403, 409 (já decidido por outra pessoa → recarregar item).

### 4.7 Férias (desenhada) — `/rh/ferias`
- **Dados:** por colaborador: `GET /employees/:id/vacation-periods` (período aquisitivo com `entitledDays`, `remainingDays`, `grantDeadline`, `unjustifiedAbsences`, `vacations[]` com `status` solicitada/aprovada/recusada/cancelada/gozada, `days`, `cashBonusDays`, `daysPaidInDouble`). Ações: `POST /employees/:id/vacation-periods`, `POST /employees/:id/vacations`, `POST /vacations/:id/approve|reject|cancel`. **Calendário do setor com limite de simultâneos: MOCK** (precisa de endpoint de lista por setor/mês).
- **Layout:** abas por setor; régua de 31 dias com ocupação diária; uma faixa por pessoa (aprovado cheio, pendente tracejado, recusado âmbar); fila de pendentes com "Dentro/Acima do limite do setor"; mensagens de limite. **Regra do design:** aprovar bloqueado quando ultrapassa o limite; no back a recusa devolve **409 `FERIAS_SETOR_DESFALCADO`** → mostrar o motivo e a próxima janela livre **se vier da API**, senão só o motivo.
- **Guarda:** mês, setor (URL); pedido selecionado; rascunho do motivo de recusa.
- **Ação primária:** "Exportar calendário" (sem back → desabilitada com tooltip "em breve", ou gerar CSV só dos dados já na tela). Aprovar/recusar: rh e gestor; cancelar: rh.
- **Estados:** vazio ("Nenhum período de férias em dezembro" + CTA "Lançar férias").

### 4.8 Escalas (SEM DESIGN) — `/rh/escalas`
- **Dados:** `GET /schedules?establishmentId`, `GET /schedules/:id` (dias, `warnings`), `POST /schedules`, `PATCH /schedules/:id` (nome, carga, dias; tipo e ciclo não mudam), `GET|POST /employees/:id/schedules` (vínculo com vigência).
- **Campos do formulário:** `type` 5x2/6x1/12x36/livre, `cycleType` semanal/ciclico (+`cycleDays`, `referenceDate`), `weeklyMinutes`, dias (`position`, folga ou entrada/saída, intervalo, vira a meia-noite). Formato `HH:mm`.
- **Regra:** avisos (`carga_semanal_acima_limite`, `folgas_abaixo_minimo`, com `ruleValidFrom`) **só avisam, nunca bloqueiam** (RN06, art. 74). O alerta "Jornada de 42 h a partir de 16/12" da visão geral leva aqui.

### 4.9 Afastamentos (dentro do espelho/colaborador)
- `GET|POST /employees/:id/absences` (`type` ∈ maternidade, paternidade, casamento, obito, doacao_sangue, alistamento, inss, outro; `startDate`, `endDate`). Afastamento por atestado nasce da aprovação do atestado, não aqui. Mostrar como "afastado de D1 a D2", sem diagnóstico, para admin/gestor.

### 4.10 Banco de horas (SEM DESIGN) — `/rh/banco-horas`
- **Back:** só `GET /me/time-bank` (colaborador). **Não há rota de RH** (saldo, extrato, vencimentos, política, folga compensatória) → **MOCK** + pendência. Modelo do mock a espelhar `{ balanceMinutes, expiringIn30DaysMinutes, entries[{date,type,minutes,dueDate}] }`.

### 4.11 Fechamento (SEM DESIGN) — `/rh/fechamento`
- **Dados:** `GET /closings?establishmentId` (`referenceMonth`, `startDate`, `endDate`, `status` aberto/fechado/reaberto, `closedAt`, `reopenedAt`, `reopenReason`), `POST /closings` (`establishmentId`, `referenceMonth` AAAA-MM), `POST /closings/:id/close`, `POST /closings/:id/reopen` (**motivo obrigatório; apaga a ciência dos espelhos; evento crítico → diálogo de confirmação forte**), `POST /closings/:id/mirrors` (`generated`/`total`), `GET /closings/:id/mirrors/:employeeId`.
- **Regras:** fechar pode ser recusado por inconsistência que impede o cálculo ou ajuste pendente (409/422 → listar o que impede e linkar para a apuração/ajustes). `contador` e `admin` só leem. `pdfUrl` nulo hoje. AEJ e exportação de folha: fora (Fase 2).

### 4.12 Relatórios e Configurações (SEM DESIGN, SEM BACK)
- Relatórios (G12) e Configurações (usuários, escopo, parâmetros, gestor habilitado, feriados, `configuracoes_empresa`) **não têm rota**. Entregar a rota com estado vazio "Em breve" e `AlertCard` explicando; não inventar contrato.

### 4.13 Estabelecimento e setor (transversal)
- `GET /portal/establishments` e lista de setores: **MOCK**. O escopo real vem de `me.establishmentScope` (`null` = conta inteira). Seletor mostra só os permitidos; trocar de estabelecimento invalida todos os recursos em tela.

## 5. Portal do funcionário (mobile first) — `/me`

Quatro abas inferiores (Início, Espelho, Férias, Atestado), 390 px, alvos de toque ≥ 48 px, linguagem simples, poucos cliques. Só `/portal/me/*` (o proxy repassa). Papel `colaborador`; qualquer outro papel vê 403 do design ("Esta página mostra dados de outro colaborador…").

| Aba | Dados | Guarda | Ações / estados |
|---|---|---|---|
| **Início** | `GET /portal/me/time-bank` (`balanceMinutes`, `expiringIn30DaysMinutes`, entradas) e `GET /portal/me/timesheets?from=hoje&to=hoje` (marcações de hoje, escala do dia). "Avisos" (férias aprovadas, espelho ciente) **DERIVADO** de `me/vacations` e `me/mirrors`; **sem endpoint de avisos** | nada persistente | Saldo grande (verde-limão sobre azul), botão "Enviar atestado" → aba Atestado, chips Entrada/Intervalo/Volta/Saída (pendente tracejado). Vazio recém-admitido (`00:00`, "Ainda não há marcações"), banner de erro com "Tentar de novo" mantendo o último dado |
| **Espelho** | `GET /portal/me/timesheets?from&to` (dias do mês) e `GET /portal/me/mirrors` (competências: `closingId`, `referenceMonth`, `status`, `acknowledgedAt`) → `GET /me/mirrors/:closingId` | mês exibido | Lista por dia (dia da semana, marcações, total, situação: Normal/Extra/Folga/Feriado/Ajuste aprovado), totais Trabalhado/Extras; **ciência**: `POST /portal/me/mirrors/:closingId/acknowledge` (só com período fechado; reabrir invalida); "Pedir ajuste de marcação" → `POST /portal/me/adjustments` (`date`, `type`, `proposedAt` só na inclusão, `reason`) em folha inferior |
| **Férias** | `GET /portal/me/vacations` (períodos aquisitivos: `entitledDays`, `remainingDays`, `grantDeadline`, `vacations[]`) | rascunho do pedido | "Dias disponíveis 19 de 30", lista "Próximas" com status; `POST /portal/me/vacations` (`accrualPeriodId, startDate, endDate, cashBonusDays 0–10`); recusa por limite do setor volta com motivo (409) — exibir o motivo em linguagem simples |
| **Atestado** | `GET /portal/me/certificates` (status e `decisionReason`; **nunca** CID/análise/risco) | arquivo escolhido, `startDate`, dias ou horas (**um dos dois**) | `POST /portal/me/certificates` multipart (`file`, `startDate`, `days` 1–365 **ou** `hours` 1–24, opcionais `doctorName/Crm/CrmUf`); limite 10 MB; câmera ou galeria; estado "enviado" com protocolo (o back não devolve protocolo: usar o `id` do atestado, não inventar formato); erro de campo ("Informe de 1 a 60 dias" no design vs 1–365 na API → **valer o da API**, registrar a divergência) |

Estados comuns: carregando (skeleton), 403, erro de conexão (banner, dado antigo visível), vazio. Cabeçalho "Olá, <nome>" e "Fazenda · Setor": `me.name` existe; empresa e setor **não vêm** da API (MOCK/omitir).

## 6. Endpoints que faltam no back (registrar, não implementar sem aprovação)

| # | Endpoint necessário | Para quê | Hoje no front |
|---|---|---|---|
| 1 | `GET /portal/overview?establishmentId=` | KPIs, alertas e gráfico de extras | mock |
| 2 | `GET /portal/establishments` | seletor | mock |
| 3 | `GET /portal/departments`, `/job-titles`, `/cost-centers` | nomes de setor, cargo e centro de custo (hoje só ids) | mock |
| 4 | Apuração do dia de todos os colaboradores (`GET /portal/timesheets?date&establishmentId&departmentId&status`) | tela 4.4 | mock |
| 5 | Calendário de férias por setor, com limite | tela 4.7 | mock |
| 6 | Banco de horas para o RH (saldo, extrato, vencimentos, política) | 4.10 | mock |
| 7 | Busca por texto e filtros extras em `GET /employees` e `GET /certificates` (nome, setor, intervalo de datas) | listas | filtro no front |
| 8 | Nome/matrícula/setor do colaborador dentro de `GET /certificates` e `GET /adjustments` | evitar N+1 | cache de `/employees` |
| 9 | Dashboard (`today`, `pending`, `indicators`, `away`) do doc 04 G11 | visão geral real | mock |
| 10 | Relatórios, exportação de folha, auditoria (`GET /audit-logs`) | G12 | "em breve" |
| 11 | Avisos do colaborador (`/me/notifications`) | aba Início | derivado |
| 12 | Convite/recuperação de senha, login do colaborador, gestão de usuários | login/config | ausente |
| 13 | PDF do espelho (`pdfUrl` nulo), comprovante de batida | espelho | botão desabilitado |
| 14 | Dados do cabeçalho do funcionário (empresa, setor, escala do dia) | Início | omitido |

## 7. Pendências de verificação (nunca rodadas)

1. `next build` (o `outputFileTracingRoot` tem ajuste de caminho do Windows; conferir no Linux).
2. `docker compose build portal` (o `server.js` do standalone precisa sair em `apps/portal/server.js`; `next/font` baixa a Manrope no build, exige internet).
3. Login real com `NEXT_PUBLIC_USE_MOCKS=false` e usuário criado por `pnpm rh:create-user`.
4. Contraste 4,5:1 medido com ferramenta (só estimado).
5. Playwright (não instalado) com capturas em desktop e 360 px.
6. Decisão do Gomes sobre a pasta `Genus_ interface RH e portal/` (ficar no repositório ou sair com `git rm -r --cached` + `.gitignore`).

## 8. Divergências e decisões em aberto

- Atestado: status do design (recebido/análise/decidido) ≠ status da API (pendente/aprovado/recusado). Decisão tomada neste mapa: derivar (4.6). **[A CONFIRMAR]** com o Gomes.
- Atestado do funcionário: design pede 1–60 dias, API aceita 1–365. Valer a API.
- Salário: visível para rh e admin no back, `security-lgpd.md` diz "só RH" **[A CONFIRMAR]**; o front esconde para os demais por padrão.
- Gestor desligado por padrão: telas de aprovação precisam funcionar sem ele.
- Cadastro facial no painel de RH: fora do escopo desta entrega.
- Docs a atualizar no fim: `docs/architecture/04-funcionalidades-rh.md` (seção do portal) e `apps/portal/README.md`.

## 9. Componentes novos a construir antes das telas

`AppRoutes`/layout por papel · `DataTable` (cabeçalho semântico, ordenação, linha clicável, rodapé) · `Tabs` com contagem · `Drawer` (painel lateral) · `Dialog` de confirmação (com campo de motivo) · `Toast` (`aria-live`) · `Field`/`Input`/`Select`/`DateInput`/`FileInput` com erro por campo · `PeriodPicker` · `StatusBadge` (ícone + rótulo, nunca só cor) · `RiskBadge` e `RiskBar` · `PunchChips` e `DayTimeline` (segmentos da jornada) · `VacationGantt` · `BottomNav` (mobile) · `MoneyMinutes` (formata minutos em `HH:mm`) · `formatCpf`/`formatDate` (fuso `America/Sao_Paulo`, sem `new Date()` solto).

## 10. Ordem sugerida de entrega

1. **Fundação:** roteamento + guarda por papel, login, novos componentes da seção 9, `contracts.ts` e `rh.ts` completos (tipos das rotas reais), cache de colaboradores/estabelecimentos, mocks faltantes.
2. **Atestados** (4.6) → **Apuração** (4.4 + 4.3) → **Ajustes** (4.5) → **Férias** (4.7) → **Colaboradores** (4.2) → **Escalas** (4.8) → **Fechamento** (4.11) → Banco de horas e Relatórios/Configurações (esqueletos).
3. **Portal do funcionário** (seção 5), em paralelo com 2 depois da fundação (arquivos independentes).
4. Header (período e ação primária), sidebar navegável, visão geral ligada às telas.
5. Verificações da seção 7, documentação e README.
