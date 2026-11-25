# Super Admin: onde parou e como continuar (handoff de 25/11/2026)

Para o próximo Claude (ou pessoa) que pegar esta funcionalidade. Leia primeiro, nesta ordem:

1. `CLAUDE.md`.
2. `CLAUDE.local.md` (se existir na máquina).
3. `docs/prompts/super-admin.md`, o pedido original.
4. `docs/prompts/super-admin-contrato.md`, o contrato vigente.
5. Este arquivo.

O plano aprovado está resumido na seção 2.

Branch: `feat/rh` no fork `LucasESGomes/Genus` (remoto `fork`). Tudo está num commit só, "Super admin: ...".

## 1. Resumo do estado

| Parte | Código | typecheck + lint | Testes unitários | Testes de integração (Postgres real) |
|---|---|---|---|---|
| Contrato, guarda, fiação (`contract.ts`, `deps.ts`, `super-admin/routes.ts`, `app.ts`, `container.ts`) | pronto | ✅ | n/a | ❌ **não rodados** |
| Migrations 0014 (gerada) e 0015 (regras, SQL manual) | pronto | ✅ | n/a | ❌ não aplicadas em banco real nesta sessão |
| `tenants` + bootstrap do `.env` + suspensão (agente A) | pronto, mas **o agente foi interrompido** antes do relatório final | ✅ | `rules/cnpj` | ❌ |
| `audit`, `access-logs`, `recognition-logs` + gravação de tentativas de login (agente B) | pronto | ✅ | ✅ 27/27 | ❌ |
| `stats`, `system-health` (agente C) | pronto | ✅ | ✅ 49/49 | ❌ |
| Portal: shell `/admin`, Visão geral, Empresas, ativar 2FA (agente D) | pronto | ✅ | ✅ 42 por arquivo (mock 13, AdminShell 5, TwoFactorSetup 5, Overview 6, Tenants 13) | n/a |
| Portal: Auditoria, Acessos, Reconhecimento, Saúde, Perfil (agente E) | escrito, mas **o agente foi interrompido** no meio dos testes (último ajuste: ambiguidade de "Batidas" num teste) | ✅ | ⚠️ não confirmados | n/a |
| Labels pt-BR e fixtures de teste (Haiku 2) | pronto | ✅ | ✅ 6/6 e 13/13 | n/a |
| Postman (coleção "Genus Super Admin") e docs (Haiku 1) | pronto | n/a | n/a | ❌ nunca rodado contra a api |
| Fluxo ponta a ponta no navegador e Playwright | **não feito** | | | |
| Revisão independente de riscos (Fase 3) | **não feita** | | | |

**Por que os testes de integração não rodaram:** a máquina ficou sem memória (cerca de 278 MB livres de 8 GB). O Docker Desktop foi ligado durante a sessão e subiu sozinho o stack de dev (`genus-*`, política de restart), que consumia muita CPU e RAM. O Testcontainers nunca deixou um Postgres saudável a tempo, até em testes que já existiam (`schema-rh.test.ts` deu timeout). **Não é falha conhecida do código, mas também não está verificado.** Espere pequenos ajustes no primeiro run real.

## 2. Decisões tomadas com o usuário (não reabrir)

- **Reconhecimento só com agregados.** A `04` §1.4 proíbe o super_admin de ver batidas e dados de colaborador. Além disso, o `arp.entradas` não guarda falhas, liveness recusado, latência nem IP. Os campos `notRecognized`, `livenessFailed`, `latencyP50Ms` e `latencyP95Ms` são sempre `null` (a tela mostra "Indisponível: depende do coletor").
- **`MASTER_KEY` agora também na api do RH**, só para gerar a DEK da empresa criada pelo painel. Sem ela: `POST /tenants` → 503 `MASTER_KEY_AUSENTE`.
- **Suspensão bloqueia só o portal.** Os totens continuam registrando (Portaria 671). Isso está marcado **[A CONFIRMAR]**.
- **Entraram:**
  - a tabela `rh.tentativas_login` (e-mail só como HMAC);
  - a dependência `@genus/queue` na api (leitura do Valkey);
  - a variável `COLLECTOR_API_URL`.
- **Mudanças minhas (coordenador) em relação ao prompt:**
  - **`MFA_REQUIRED`:** o super_admin sem 2FA recebe 403 com esse código, em vez de `FORBIDDEN`, para o portal levá-lo a `/admin/ativar-2fa`.
  - **2FA sem QR:** a chave é mostrada em texto, para evitar uma dependência nova.
  - **FK `contas.suspensa_por_id`:** fica só na 0015, porque no Drizzle ela cria um ciclo de tipos entre `contas` e `usuarios`.
  - **Auditoria:** usa o enum `acao` existente, com a entidade em inglês. A coluna `tenantId` da auditoria passou a aceitar `null` (ação de plataforma).

## 3. O que fazer agora, em ordem

1. **Máquina limpa:** pare o stack (`docker compose stop` na raiz; os volumes ficam) e feche o que pesar. Depois rode `corepack pnpm install --frozen-lockfile` (o `pnpm` pode não estar no PATH; use `corepack pnpm`).
2. **Testes de integração da api, um arquivo por vez** (de `apps/api`):
   ```bash
   npx vitest run test/schema-rh.test.ts            # migrations 0014/0015 aplicam do zero
   npx vitest run test/auth.test.ts                 # MFA_REQUIRED, ACCOUNT_SUSPENDED, tentativas de login
   npx vitest run test/super-admin-tenants.test.ts
   npx vitest run test/super-admin-bootstrap.test.ts
   npx vitest run test/super-admin-audit.test.ts
   npx vitest run test/super-admin-access.test.ts
   npx vitest run test/super-admin-recognition.test.ts
   npx vitest run test/super-admin-stats.test.ts
   npx vitest run test/super-admin-health.test.ts
   npx vitest run test/super-admin-guard.test.ts    # matriz: 20 rotas × todos os papéis
   npx vitest run                                    # suíte inteira no fim
   ```
   Corrija o que falhar. Pontos mais prováveis:
   - SQL dos repositórios: `stats/repository.ts`, `arp/ops-reader.ts`, `arp/recognition-reader.ts`, `tenants/repository.ts`.
   - Fixtures de `fechamentos` em `super-admin-stats.test.ts`.
   - Trigger da 0015.
   - O hook de tentativas de login em `modules/auth/routes.ts`.
   - O `findSensitiveKeys` (`test/fixtures/super-admin.ts`) agora casa `password`. No `POST /tenants`, use `allow: ['temporaryPassword']`.
3. **Testes do portal, um arquivo por vez** (de `apps/portal`; a suíte inteira passa de 10 min nesta máquina):
   ```bash
   npx vitest run src/features/admin/AuditScreen.test.tsx    # e Access, Recognition, Health, Profile (agente E, não confirmados)
   npx vitest run src/features/admin src/components/admin-shell src/lib/api/mocks/super-admin.test.ts src/lib/labels src/lib/auth
   ```
4. **Revisar o trabalho dos agentes interrompidos.**
   - **Agente A:** `tenants/*`, `bootstrap.ts`, `config/env.ts`, `auth.ts`, `request-context.ts`, `user-service.ts` (`createUserWithHash`), `scripts/hash-password.ts`, `scripts/provision-tenant.ts` (refatorado para usar o service), `scripts/setup-dev.mjs` e a 0015. Confira que `setup:dev` grava `SUPER_ADMIN_*`, `MASTER_KEY`, `VALKEY_URL` e `COLLECTOR_API_URL` no `apps/api/.env.dev` e mostra a senha uma vez.
   - **Agente E:** as cinco telas em `apps/portal/src/features/admin/` e as páginas em `src/app/admin/(painel)/`.
5. **Ponta a ponta:** `pnpm setup:dev && pnpm dev:up && pnpm dev`, depois o portal em `/login` e esta sequência:
   1. Entrar com o super_admin do `.env.dev`, que leva a `/admin/ativar-2fa`.
   2. Ativar o 2FA no app autenticador.
   3. Em `/admin/empresas`, criar uma empresa e anotar a senha provisória.
   4. Ver a empresa na lista.
   5. Entrar com o admin dela.
   6. Voltar como super_admin e suspender a empresa. O admin dela passa a receber "Conta suspensa" (401 `ACCOUNT_SUSPENDED`).
   7. Reativar a empresa.

   Depois, escreva o Playwright desse fluxo em `apps/portal/e2e/super-admin.spec.ts`. O Playwright já está nas devDependencies; o TOTP no teste exige gerar o código a partir da chave, procure um helper ou use `otplib` só se for aprovado como dependência.
6. **Postman:** a coleção "Genus Super Admin" é manual. O `pnpm postman:test` só roda a do coletor. Rode-a no Postman com `superAdminToken` (JWT de `GET /auth/token`). Salve os `*.example.yaml` que o `api-testing.md` §8 pede. Inclua `password` no padrão de chave sensível dos testes da coleção, para alinhar com a fixture.
7. **Fase 3 (revisão independente):** um agente sem contexto audita só os riscos:
   - isolamento entre papéis;
   - vazamento de dado sensível ou biometria;
   - auditoria faltando;
   - SQL sem filtro;
   - segredo em log ou resposta;
   - bootstrap promovendo usuário de outro papel;
   - `temporaryPassword` fora da resposta de criação.
8. **PR:** só quando o usuário pedir. Título `[RH] Super Admin: CRUD de contas e painel da operação`. A descrição segue o formato do `CLAUDE.local.md`.

## 4. Mapa dos arquivos

- **Back (`apps/api`):**
  - `src/modules/super-admin/`: `contract.ts` (Zod, fonte da verdade), `deps.ts`, `routes.ts` (guarda `onRequest`), `period.ts`, `bootstrap.ts`, `tenants/`, `audit/`, `access-logs/` (+ `email-hash`, `login-outcome`, `rules/flag-ips`), `recognition-logs/`, `stats/` (+ `rules/aggregate`), `system-health/` (+ `queue-inspector`, `rules/classify-health`).
  - `src/arp/recognition-reader.ts` e `src/arp/ops-reader.ts`.
  - `src/db/schema/super-admin.ts`, `drizzle/0014_super_admin.sql` e `drizzle/0015_regras_super_admin.sql`.
  - Testes: `test/super-admin-*.test.ts`, `test/fixtures/super-admin.ts` e `test/support/{portal.ts,json-keys.ts}` (o harness tem `loginAsSuperAdmin()` e as dependências do super_admin como stubs).
- **Front (`apps/portal`):**
  - `src/app/admin/(painel)/*` (com `AuthGate area="admin"` + `AdminShell`) e `src/app/admin/ativar-2fa` (fora do gate).
  - `src/features/admin/*`, `src/components/admin-shell/*`.
  - `src/lib/api/{super-admin-contracts.ts,endpoints/super-admin.ts,mocks/super-admin.ts}`, `src/lib/labels/super-admin.ts`, `src/lib/cnpj.ts`.
  - Gate e permissões em `src/lib/auth/{gate.tsx,permissions.ts}`.
- **Docs:** a seção "Super Admin" na `04`, o glossário em `database.md` §12, `security-lgpd.md` §2/§5/§8, `apps/api/README.md` ("Como entrar como super_admin localmente") e o contrato em `docs/prompts/super-admin-contrato.md`.

## 5. Pendências conhecidas (fora do escopo ou a confirmar)

- **Para o colega do ponto** (collector-api e arp, fora do escopo do RH):
  - gravar as tentativas de reconhecimento (não reconhecido, liveness falho, latência, IP);
  - criar o índice `entradas (conta_id, marcado_em)`. Sem ele, os agregados de 30 dias varrem a tabela.
- **Gravação de tentativas de login:** o TOTP só é gravado quando o cookie de desafio do 2FA identifica o usuário. A verificação durante a ativação do 2FA não é gravada.
- **Saúde com `queues` null:** rep_core e jobs ficam `ok` se o arp estiver bem (o Valkey já aparece `degraded`). Decida se devem ficar `degraded`.
- **[A CONFIRMAR]:**
  - suspensão não para os totens;
  - retenção de 90 dias de `tentativas_login`;
  - limiares de sinalização de IP (10 falhas em 15 min; 3 e-mails em 1 h);
  - limiares de saúde (`rules/classify-health.ts`).
- **Não entram nesta rodada:** acesso excepcional de suporte (04 §1.4, §9 item 22), reset de senha e desbloqueio de usuário do cliente, liga/desliga de funcionalidade por empresa, QR do 2FA e sidebar recolhível no `/admin`.
- **Portal:** `DEMO_EMAILS` em `features/auth/copy.ts` não lista `superadmin@` (modo mock). `renderWithSession` tipa `role` sem `super_admin`; os testes usam `me: mockMeFor('super_admin')`.
