# Contrato: Super Admin

Único ponto de acoplamento entre back e front do painel do `super_admin`. Fonte da verdade em código:
`apps/api/src/modules/super-admin/contract.ts` (Zod) e o espelho `apps/portal/src/lib/api/super-admin-contracts.ts`.
Só o coordenador muda estes três arquivos.

## Regras

- Rotas sob `/portal/super-admin`. Guarda `authorize('super_admin')` no **escopo** (`onRequest`): toda rota, antes da validação. Cliente (admin, rh, gestor, contador, colaborador) → 403. super_admin sem 2FA → 403. Sem sessão → 401.
- `tenantId` de outra conta só por parâmetro de rota ou query validados. Nunca do corpo.
- Respostas são `strictObject`. Nunca saem CPF, nome de colaborador, batida individual, dado de saúde, biometria, `_hash`, `_cifrado`, `email_hash`, token ou segredo. Única exceção: `temporaryPassword`, só na resposta de `POST /tenants`.
- Reconhecimento: **só agregados** de `arp.entradas` (04 §1.4). `notRecognized`, `livenessFailed`, `latencyP50Ms` e `latencyP95Ms` são sempre `null`, porque o arp não guarda tentativas falhas nem latência (depende do coletor).
- Toda escrita é auditada na mesma transação. Toda leitura entre contas (auditoria, acessos, reconhecimento, stats por conta) grava uma linha `leitura_sensivel` por requisição, com os filtros em `dados_depois`.
- Suspender = `contas.ativo = false` + `motivo_suspensao`; derruba as sessões da conta. Os totens continuam registrando batidas **[A CONFIRMAR]**.

## Endpoints

| Método e rota | Query / corpo | Resposta (`data`) |
|---|---|---|
| `GET /tenants` | `q, status=ativa\|suspensa, page, pageSize` | `TenantDto[]` + `meta` |
| `POST /tenants` | `createTenantBody` | `{ tenant, admin, temporaryPassword }` (201) |
| `GET /tenants/:tenantId` | | `TenantDetailDto` |
| `PATCH /tenants/:tenantId` | `{ name }` | `TenantDetailDto` |
| `POST /tenants/:tenantId/suspend` | `{ reason }` | `TenantDetailDto` |
| `POST /tenants/:tenantId/reactivate` | `{ reason }` | `TenantDetailDto` |
| `GET /audit-logs` | `tenantId, userId, entity, action, from, to, cursor, limit` | `AuditLogDto[]` + `{ nextCursor, limit }` |
| `GET /audit-logs/:id` | | `AuditLogDetailDto` (com `before`/`after` redigidos) |
| `GET /access/sessions` | `tenantId, userId, ip, active, page, pageSize` | `SessionDto[]` + `meta` |
| `GET /access/login-attempts` | `ip, tenantId, success, from, to, cursor, limit` | `LoginAttemptDto[]` + cursor |
| `GET /access/flagged-ips` | `window` | `FlaggedIpDto[]` |
| `POST /access/sessions/:sessionId/revoke` | `{ reason }` | `{ revoked }` |
| `POST /access/users/:userId/revoke-sessions` | `{ reason }` | `{ revoked }` |
| `GET /recognition/summary` | `window, tenantId, establishmentId, deviceId` | `RecognitionSummaryDto` |
| `GET /recognition/series` | idem + `bucket=hour\|day` | série |
| `GET /recognition/devices` | idem | agregado por aparelho |
| `GET /stats/overview` | `window` | `StatsOverviewDto` |
| `GET /stats/tenants/:tenantId` | `window` | `TenantStatsDto` |
| `GET /stats/growth` | `months` (1–36) | série mensal |
| `GET /system-health` | | `{ status, checkedAt, version, uptimeSeconds, checks[] }` (cache 5 s) |

`window` ∈ `24h | 7d | 30d` (padrão `24h`). `from`/`to` são ISO com fuso, intervalo `[from, to)`, no máximo 90 d (`VALIDATION_ERROR`).

## Erros (`{ error, code }`, pt-BR)

| code | HTTP | Quando |
|---|---|---|
| `ACCOUNT_SUSPENDED` | 401 | Login ou requisição de usuário de conta suspensa: "Conta suspensa. Fale com o suporte do Genus." |
| `MFA_REQUIRED` | 403 | super_admin sem 2FA (antes era `FORBIDDEN`): a sessão só serve para `/auth/two-factor/*`; o portal leva para `/admin/ativar-2fa` |
| `MASTER_KEY_AUSENTE` | 503 | `POST /tenants` sem `MASTER_KEY` no ambiente |
| `TENANT_ALREADY_SUSPENDED` | 409 | suspend em conta suspensa |
| `TENANT_NOT_SUSPENDED` | 409 | reactivate em conta ativa |
| `EMAIL_IN_USE` | 409 | e-mail do admin já existe na plataforma |
| `CNPJ_INVALIDO` | 400 | dígito verificador do CNPJ |
| `FORBIDDEN` / `UNAUTHORIZED` / `NOT_FOUND` / `VALIDATION_ERROR` | | genéricos |

## Banco (migrations 0014 e 0015, schema `rh`)

- `contas` + `motivo_suspensao TEXT`, `suspensa_em TIMESTAMPTZ`, `suspensa_por_id BIGINT → usuarios`, `atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()` (trigger). `ck_conta_suspensao_coerente`: `ativo = (suspensa_em IS NULL) AND (ativo OR motivo_suspensao IS NOT NULL)`.
- `tentativas_login` (só INSERT): `id`, `conta_id NULL`, `usuario_id NULL`, `email_hash BYTEA NOT NULL` (HMAC-SHA256), `endereco_ip TEXT`, `agente_usuario TEXT`, `etapa TEXT CHECK IN ('senha','totp')`, `eh_sucesso BOOLEAN NOT NULL`, `motivo TEXT NULL CHECK IN ('credencial_invalida','usuario_inativo','conta_suspensa','totp_invalido')`, coerente com `eh_sucesso`, `criado_em`. Índices `idx_tentativa_login_ip (endereco_ip, criado_em DESC)` e `idx_tentativa_login_criado (criado_em DESC)`.
- `idx_auditoria_usuario (usuario_id, id DESC)` e `idx_sessao_conta (conta_id, expira_em DESC)`.
- Trigger: `contas.ativo` true → false apaga `sessoes` da conta.

Drizzle: `tenants` ganha `suspensionReason`, `suspendedAt`, `suspendedById`, `updatedAt`. Tabela `loginAttempts` em `db/schema/super-admin.ts`: `tenantId`, `userId`, `emailHash`, `ipAddress`, `userAgent`, `step`, `isSuccess`, `failureReason`, `createdAt`.

## Auditoria

`entidade` em inglês, `acao` do enum existente:

- `tenant` + `criacao`.
- `tenant` + `alteracao` (PATCH; suspender e reativar com `motivo`).
- `tenant_admin` + `criacao`.
- `session` + `exclusao` (revogação, com `motivo`).
- `super_admin` + `criacao`/`alteracao` (bootstrap, `tenantId` null).
- Leituras: `audit_log`, `access_log`, `recognition_stats`, `tenant_stats` + `leitura_sensivel`. `entidade_id` é o `tenantId` filtrado, ou `0` para todas as contas.

## Env (apps/api)

`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME`, `SUPER_ADMIN_PASSWORD_HASH` (scrypt `salt:key` do Better Auth; preferido) ou `SUPER_ADMIN_PASSWORD`, `MASTER_KEY` (64 hex), `VALKEY_URL`, `COLLECTOR_API_URL`. Todas opcionais; quando faltam em prod, a api avisa em log com `warn`.
