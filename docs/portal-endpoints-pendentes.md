# Endpoints pendentes do back (propostos pelo front do portal)

Levantamento de 24/11/2026. O portal já consome estes contratos **em mock** (`NEXT_PUBLIC_USE_MOCKS=true`); com mocks desligados, cada tela mostra "Em breve". Os tipos estão em `apps/portal/src/lib/api/contracts.ts` (seção `[MOCK]`) e as chamadas em `apps/portal/src/lib/api/endpoints/*.ts`. **Nada aqui foi implementado no back**: é proposta para o Gomes revisar.

Convenções de sempre (CLAUDE.md): rotas sob `/portal`, `kebab-case`, JSON `camelCase`, sucesso `{ data }` e listas `{ data, meta }`, erro `{ error, code }`, `tenantId` da sessão, 404 (não 403) fora do escopo.

## 1. Transversais

| # | Rota | Resposta | Uso | Notas |
|---|---|---|---|---|
| 1 | `GET /portal/establishments` | `{ data: Establishment[] }` (`id`, `name`, `subtitle`) | seletor global | Só os do escopo do usuário. Incluir `timezone` (IANA) para o front parar de assumir `America/Sao_Paulo` |
| 2 | `GET /portal/departments?establishmentId=` · `GET /portal/job-titles?…` · `GET /portal/cost-centers?…` | `{ data: OrgUnit[] }` (`id`, `establishmentId`, `name`) | nomes de setor/cargo/centro (vínculo só traz ids) | |
| 3 | `GET /portal/overview?establishmentId=&from=&to=` | `{ data: Overview }` | visão geral | KPIs já formatados + alertas com `target`; gráfico de extras por dia |
| 4 | Nome, matrícula e setor do colaborador em `GET /certificates` e `GET /adjustments` | campos extras no DTO | evitar N+1 | Hoje o front resolve com `GET /employees?pageSize=100` (`useEmployeeDirectory`) |
| 5 | Busca e filtros em `GET /employees` (`q`, `departmentId`) e `GET /certificates` (`from`, `to`) | — | listas | Hoje o filtro de texto é só na página corrente |

## 2. Apuração e banco de horas

| # | Rota | Resposta | Notas |
|---|---|---|---|
| 6 | `GET /portal/timesheets?date&establishmentId&departmentId&status&q&page&pageSize` | `DayRowPage` = `Paged<DayRow>` + `counts { todos, inconsistente, falta, calculada }` | `DayRow`: colaborador (nome, matrícula, setor, cargo), marcações, previsto, trabalhado, extra, falta, `status`, `isAbsence`, `issues`. `counts` calculado sobre o filtro sem `status` |
| 7 | `POST /portal/timesheets/recalculate` `{ establishmentId, date }` | `RecalculateResult` | "Recalcular dia" do estabelecimento (hoje só existe por colaborador) |
| 8 | `GET /portal/time-bank?establishmentId&page` | `Paged<TimeBankBalanceRow>` | saldo, a vencer em 30 dias, próximo vencimento |
| 9 | `GET /portal/employees/:id/time-bank` | `TimeBank` (mesmo formato de `/me/time-bank`) | extrato para o RH |

## 3. Férias

| # | Rota | Resposta | Notas |
|---|---|---|---|
| 10 | `GET /portal/vacations/calendar?establishmentId&month=AAAA-MM&departmentId` | `VacationCalendar` | por setor: `headcount`, `maxSimultaneous`, `dailyOccupancy[]` (calculado no back), linhas com `exceedsLimit` e `nextFreeStartDate`. O front não calcula limite |
| 11 | 409 `FERIAS_SETOR_DESFALCADO` com `details.nextFreeStartDate` | — | para sugerir a próxima janela livre |

## 4. Totens (aparelhos) e calibração

O RH tem a tabela `rh.aparelhos` (`id`, `conta_id`, `estabelecimento_id`, `nome`, `eh_ativo`, `criado_em`) e **nenhuma rota**. Contrato inspirado em `visage/backend/src/routes/devices.ts` (só referência). Autorização: `rh` e `admin` gerenciam; `gestor`/`contador` não acessam.

| Rota | Corpo | Resposta | Regras |
|---|---|---|---|
| `GET /portal/devices?establishmentId&connection` | — | `{ data: Device[] }` | `Device`: `id`, `establishmentId`, `name`, `isActive`, `connection` (`online`/`offline`/`inativo`), `lastSyncAt`, `pendingPunches`, `appVersion`, `calibrationState` (`calibrado`/`padrao`/`desatualizado`), `hasPunches`, `createdAt`. **Nunca** a chave |
| `POST /portal/devices` | `{ establishmentId, name }` | `{ data: { device, apiKey } }` | `apiKey` aparece **uma vez** (o banco guarda só hash). 409 `APARELHO_NOME_DUPLICADO` (nome único por estabelecimento) |
| `GET /portal/devices/:id` | — | `{ data: Device }` | |
| `PATCH /portal/devices/:id` | `{ name?, isActive? }` | `{ data: Device }` | desativar/reativar |
| `DELETE /portal/devices/:id` | — | 204 | **409 `APARELHO_COM_BATIDAS`** se já registrou batida (Portaria 671: o registro de origem não some; só desativa) |
| `POST /portal/devices/:id/regenerate-key` | — | `{ data: { device, apiKey } }` | invalida a chave anterior; evento de auditoria |
| `GET /portal/devices/:id/activity` | — | `{ data: DeviceActivity[] }` | sincronização, conexão, calibração, chave regenerada, ativado/desativado. **Sem dado pessoal** |
| `GET /portal/devices/:id/calibration` | — | `{ data: DeviceCalibrationSettings }` | atual vs. padrão da conta (`null` = herda) |
| `GET /portal/devices/:id/calibration/session` | — | `{ data: CalibrationProgress }` | progresso da sessão no aparelho |
| `POST /portal/devices/:id/calibration/start` | — | `{ data: CalibrationProgress }` | inicia a captura no totem (o totem fotografa; o painel só acompanha) |
| `DELETE /portal/devices/:id/calibration/session` | — | 204 | descarta amostras |
| `POST /portal/devices/:id/calibration/compute` | — | `{ data: CalibrationResult }` | `current`, `proposed`, `qualityScore`, `recommendations`, `distanceHistogram` agregado. **Nenhuma imagem nem embedding na resposta** |
| `PUT /portal/devices/:id/calibration/settings` | `{ recognitionThreshold, livenessThreshold }` | `{ data: DeviceCalibrationSettings }` | aplica o proposto |
| `DELETE /portal/devices/:id/calibration/settings` | — | `{ data: DeviceCalibrationSettings }` | volta ao padrão |
| `POST /portal/devices/:id/calibration/copy` | `{ sourceDeviceId }` | `{ data: DeviceCalibrationSettings }` | só de totem do **mesmo estabelecimento**; 404 fora do escopo |

Regra de produto que a tela comunica: **a calibração ajusta sensibilidade; nunca bloqueia batida** (Portaria 671). Abaixo do limiar o registro continua e vai para revisão. **[A CONFIRMAR]** com o Gomes se o limiar só sinaliza (como o resto do sistema) e como isso aparece para o RH.

## 5. Relatórios, configurações, contas

| # | Rota | Notas |
|---|---|---|
| 12 | `POST /portal/reports` `{ type, establishmentId, departmentId?, from, to, format }` → job; `GET /portal/reports/:id` | tipos RF58: `horas_extras`, `faltas`, `banco_horas`, `ferias`, `afastamentos`. Arquivo no S3, download autenticado |
| 13 | `GET/POST/PATCH /portal/users` (perfil, escopo de estabelecimentos, 2FA, ativo) | gestão de usuários |
| 14 | `GET/PUT /portal/settings` (`managerPortalEnabled`, `maxSimultaneousVacationsPerDepartment`, `punchToleranceMinutes`) | `configuracoes_empresa` |
| 15 | `GET/POST/DELETE /portal/holidays?establishmentId&year` | feriados nacional/estadual/municipal/empresa |
| 16 | Convite, recuperação de senha, login do colaborador | dependem de e-mail |
| 17 | `GET /portal/audit-logs` | trilha de auditoria (G12) |
| 18 | `pdfUrl` do espelho e comprovante de batida | botão hoje desabilitado |
| 19 | `GET /portal/me/notifications` | avisos do colaborador (hoje derivados de férias e espelhos) |
| 20 | Empresa e setor do colaborador em `/me` | cabeçalho do portal do funcionário |

## 6. Segurança (IDOR): recomendações ao back

Ver o relatório final do orquestrador. Resumo:

1. **IDs públicos.** Os DTOs expõem `id: number` (BIGINT sequencial). Migrar para `publicId` (UUID, coluna `id_publico` da convenção) em: `Employee`, `Assignment`, `Schedule`, `EmployeeSchedule`, `Adjustment`, `Absence`, `Certificate`/`CertificateRh`/`MyCertificate`, `CertificateAnalysis`, `AccrualPeriod`, `Vacation`, `Closing`, `Mirror.closing`, `Me` (`id`, `tenantId`, `employeeId`, `establishmentScope`) e todo `*Id` de referência. O front já trata IDs como string opaca: a troca é só em `lib/api/ids.ts`.
2. **Testes de outra conta/escopo** faltando em `schedules/:id`, `vacations/*` (approve/reject/cancel por id), `absences` e `timesheets` (só cobertos pelo filtro do colaborador).
3. **Rate limit** em respostas 404 por usuário (varredura de IDs), com alerta de auditoria acima de um limiar.
