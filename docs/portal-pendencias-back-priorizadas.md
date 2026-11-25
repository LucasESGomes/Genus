# O que o front já tem e ainda não funciona sem back (priorizado)

Levantamento de 25/11/2026. Cada item já tem tela pronta em `apps/portal`, roda em mock (`NEXT_PUBLIC_USE_MOCKS=true`) e mostra "Em breve" com o back real. Contratos propostos: `docs/portal-endpoints-pendentes.md`. **Fora desta lista** (em implementação nesta rodada, `docs/totem-contrato.md`): totens, chave do aparelho, calibração, totem web com ponto e cadastro facial, busca por texto em colaboradores/ajustes/atestados/escalas.

**Prioridade:** P1 = trava o uso diário do MVP · P2 = o RH contorna, mas faz falta · P3 = Fase 2 ou conforto.
**Esforço** (estimativa, com o que já existe no back): **XS** até 2 h · **S** meio dia · **M** 1–2 dias · **L** 3+ dias.

## Fazer primeiro: alto valor, pouco esforço

| # | Funcionalidade (tela) | Endpoint | Prioridade | Esforço | Por que é rápido |
|---|---|---|---|---|---|
| 1 | Seletor de estabelecimento com nomes reais (todas) | `GET /portal/establishments` | P1 | XS | tabela `estabelecimentos` existe; filtrar por `establishmentScope`. Incluir `timezone` |
| 2 | Nome e matrícula na fila de atestados e de ajustes | campos nos DTOs de `GET /certificates` e `GET /adjustments` | P1 | XS | join com `colaboradores` (o mesmo da busca por texto). Remove o limite de 100 do diretório do front |
| 3 | Nomes de setor, cargo e centro de custo (colaboradores, vínculos, filtros) | `GET /portal/departments`, `/job-titles`, `/cost-centers` | P1 | XS | tabelas do G1; só listagem por estabelecimento |
| 4 | Banco de horas do RH: saldos e extrato | `GET /portal/time-bank`, `GET /portal/employees/:id/time-bank` | P1 | S | as tabelas e a consulta já existem para `/me/time-bank`; falta a versão por estabelecimento com escopo |
| 5 | Apuração do dia de todos (`/rh/apuracao`) | `GET /portal/timesheets?date&establishmentId&departmentId&status&q` | P1 | S | `apuracoes_dia` já é calculada por colaborador; é uma consulta paginada com contagens por status |
| 6 | Recalcular o dia do estabelecimento (`/rh/apuracao`) | `POST /portal/timesheets/recalculate` `{ establishmentId, date }` | P2 | S | reaproveita o recálculo por colaborador, publicando um job por pessoa |

## Depois: valor alto, esforço médio

| # | Funcionalidade (tela) | Endpoint | Prioridade | Esforço | Observação |
|---|---|---|---|---|---|
| 7 | Visão geral: KPIs, alertas e gráfico de extras por dia (`/rh`) | `GET /portal/overview?establishmentId&from&to` | P1 | M | agregações sobre `apuracoes_dia`, atestados, férias; alertas a partir das inconsistências e avisos de escala |
| 8 | Login do colaborador, convite e recuperação de senha (`/login`, `/me`) | Better Auth + envio de e-mail | P1 | M | o portal `/me` só funciona para usuário criado à mão. **Provedor de e-mail [A DECIDIR]** |
| 9 | Calendário de férias por setor com limite de simultâneos (`/rh/ferias`) | `GET /portal/vacations/calendar` + `details.nextFreeStartDate` no 409 | P2 | M | o limite por setor já existe na regra do back (409 `FERIAS_SETOR_DESFALCADO`); falta a consulta mensal |
| 10 | Configurações da empresa: portal do gestor, limite de férias por setor, tolerância (`/rh/configuracoes`) | `GET/PUT /portal/settings` | P2 | S | tabela `configuracoes_empresa`; a tolerância legal fica no servidor **[A CONFIRMAR]** |
| 11 | Usuários e escopo (`/rh/configuracoes`) | `GET/POST/PATCH /portal/users` | P2 | M | criação já existe em script (`rh:create-user`); falta a api e a auditoria |
| 12 | Feriados (`/rh/configuracoes`) | `GET/POST/DELETE /portal/holidays` | P2 | M | G3; o cálculo da jornada precisa ler a mesma tabela |

## Mais tarde: esforço alto ou Fase 2

| # | Funcionalidade (tela) | Endpoint | Prioridade | Esforço | Observação |
|---|---|---|---|---|---|
| 13 | PDF do espelho assinado (`/rh/fechamento`, espelho do colaborador) | `pdfUrl` no `Mirror` | P2 | L | depende do `signer` (PAdES) e do S3 |
| 14 | Relatórios RF58: extras, faltas, banco, férias, afastamentos (`/rh/relatorios`) | `POST /portal/reports` + `GET /portal/reports/:id` | P3 | L | geração assíncrona, arquivo no S3 |
| 15 | Exportar calendário de férias e AEJ | — | P3 | M | AEJ é Fase 2 (RF50) |
| 16 | Avisos do colaborador (`/me`, Início) | `GET /portal/me/notifications` | P3 | M | hoje derivados de férias e espelhos |
| 17 | Empresa e setor no cabeçalho do `/me` | campos em `GET /me` ou `/portal/me/profile` | P3 | XS | |
| 18 | Trilha de auditoria | `GET /portal/audit-logs` | P3 | S | tabela de auditoria já existe |
| 19 | Lançar folga compensatória (`/rh/banco-horas`) | política e lançamento manual | P3 | M | regra de política de banco **[A CONFIRMAR]** |

## Ordem sugerida

1 → 2 → 3 → 5 → 4 → 7 → 8 → 6 → 10 → 9 → 11 → 12 → 13 → 17 → 18 → 14 → 16 → 15 → 19.

Os itens 1 a 5 cabem em um ou dois dias e tiram as quatro telas mais usadas do mock.
