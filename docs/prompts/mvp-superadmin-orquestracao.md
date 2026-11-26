# MVP super admin: orquestração (25/11/2026)

Três agentes em paralelo, na mesma cópia de trabalho, branch `feat/mvp-superadmin`. Cada um lê **as regras comuns, os contratos e só a própria seção**.

| Agente | Entrega | Só pode editar |
|---|---|---|
| A | Back: empresas, estabelecimentos, `GET /portal/establishments` | `apps/api/src/modules/super-admin/organization/**`, `apps/api/src/modules/establishments/**`, `apps/api/test/{super-admin-organization,establishments}.test.ts`, `postman/` (só requests novos de A) |
| B | Back: convites e permissão de colaborador | `apps/api/src/modules/{invites,super-admin/invites,employees}/**`, `apps/api/src/{db/schema,config}/**`, `apps/api/drizzle/**`, `apps/api/src/{app,container}.ts`, `apps/api/src/modules/{portal,super-admin}/deps.ts`, `apps/api/test/support/**`, `apps/api/test/{invites,employees*,super-admin-guard}.test.ts`, `docs/architecture/04-funcionalidades-rh.md`, `docs/conventions/database.md`, `postman/` (só requests novos de B) |
| C | Front | `apps/portal/**` |

Já feito pelo coordenador (não mexer): o 404 do super admin, os stubs `routes.ts` e o registro deles em `portal/routes.ts` e `super-admin/routes.ts`, as variáveis nos composes.

## Regras comuns

- Siga o `CLAUDE.md`. Copie o padrão do módulo vizinho (`modules/super-admin/tenants/`, `features/admin/`); não explore o repositório além do necessário.
- Toda query filtra por `conta_id`. Escrita em transação, com `recordAudit` na mesma transação. Sem CPF, token ou hash em log, auditoria ou resposta.
- **Economia e memória:** sem subagentes, sem servidores, sem Docker, sem `git add/commit/checkout`. Não rode testes de integração (o coordenador roda). No fim, rode só o typecheck e o lint do seu app, uma vez, e os testes sem banco dos arquivos que você criou. `pnpm` = `corepack pnpm`.
- Se precisar de arquivo fora da sua coluna, não edite: diga no relatório.
- Relatório final: no máximo 12 linhas (feito, não feito, o que o coordenador precisa rodar).

## Contratos (valem para back e front)

Sucesso `{ data }`; erro `{ error, code }` em pt-BR. IDs numéricos. Respostas em `strictObject`.

### Empresas e estabelecimentos (super_admin, base `/portal/super-admin/tenants/:tenantId`)

```
Establishment = { id, companyId, name, registrationType: 'CNPJ'|'CPF'|'CAEPF', registration, uf, municipalityIbge, isActive }
Company       = { id, legalName, cnpj, isActive, establishments: Establishment[] }
```

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /companies` | | `Company[]` |
| `POST /companies` | `{ legalName, cnpj }` | 201 `Company` (gera a DEK da empresa) |
| `PATCH /companies/:companyId` | `{ legalName?, cnpj?, isActive? }` | `Company` |
| `POST /companies/:companyId/establishments` | `{ name, registrationType, registration, uf, municipalityIbge }` | 201 `Establishment` |
| `PATCH /establishments/:establishmentId` | campos acima, parciais, + `isActive` | `Establishment` |

Erros: 404 `NOT_FOUND` (inclusive id de outra conta), 400 `CNPJ_INVALIDO`, 409 `CNPJ_DUPLICADO`, 409 `INSCRICAO_DUPLICADA`, 409 `REGISTRO_EM_USO` (mudar `cnpj` da empresa ou `registrationType`/`registration` do estabelecimento que já tem colaborador), 409 `EMPRESA_INATIVA` (criar estabelecimento nela), 503 `MASTER_KEY_AUSENTE`. Não há DELETE: excluir é `isActive: false`. Desativar nunca afeta batidas.

### `GET /portal/establishments` (admin, rh, gestor, contador, colaborador)

`{ data: { id, name, subtitle, isActive }[] }`, `subtitle` = razão social. Só a conta e o escopo da sessão; o colaborador recebe só o próprio. Ordem: nome.

### Convites (magic link com confirmação de CPF)

```
Invite = { id, name, email, role: 'admin'|'rh', status: 'pendente'|'aceito'|'revogado'|'expirado', expiresAt, createdAt, acceptedAt: string|null }
```

| Rota | Quem | Corpo | Resposta |
|---|---|---|---|
| `GET /portal/invites` | `admin` | | `Invite[]` |
| `POST /portal/invites` | `admin` | `{ name, email, role, cpf }` | 201 `{ invite, token }` |
| `POST /portal/invites/:inviteId/revoke` | `admin` | | `Invite` |
| idem sob `/portal/super-admin/tenants/:tenantId/invites` | super_admin | | idem |
| `POST /portal/public/invites/preview` | público | `{ token }` | `{ tenantName, name, emailMasked, role, expiresAt }` |
| `POST /portal/public/invites/accept` | público | `{ token, cpf, password }` | 201 `{ email }` |

- `token`: 32 bytes aleatórios em base64url, devolvido **uma vez**; o banco guarda só o SHA-256. O portal monta o link `<origem>/convite#<token>` (fragmento: não cai em log). Não há envio de e-mail.
- `cpf`: 11 dígitos, válido; o banco guarda só HMAC-SHA256 com chave derivada do `BETTER_AUTH_SECRET`.
- Validade 72 h, uso único. CPF errado: 400 `CPF_NAO_CONFERE`; na 5ª falha o convite é revogado. Limite por IP nas rotas públicas (429).
- Token inexistente, expirado, usado, revogado ou de conta suspensa: 404 `CONVITE_INVALIDO`, sem diferenciar.
- Novo convite para o mesmo e-mail na conta revoga o pendente anterior. E-mail já usuário: 409 `EMAIL_IN_USE`. CPF inválido: 400 `CPF_INVALIDO`.
- Senha: mínimo do `auth.ts`. Aceitar cria o usuário (`UserService`) na mesma transação que marca o convite.

## Agente A: organização

- `modules/super-admin/organization/{routes,schemas,service,repository}.ts`; a guarda super_admin já está no escopo pai.
- Reaproveite `tenants/repository.ts` (inserts e DEK) e `tenants/rules/cnpj.ts` sem editá-los. Empresa nova **precisa** da DEK em `chaves_empresa`, senão o cadastro facial falha.
- `modules/establishments/{routes,schemas,service}.ts` para o `GET`.
- Sem migration: as tabelas já existem.
- Testes: `test/super-admin-organization.test.ts` (inclui outra conta → 404 e papel de cliente → 403) e `test/establishments.test.ts`, usando `test/support/portal.ts` sem editá-lo.

## Agente B: convites e permissões

- Tabela `rh.convites_usuario` (`conta_id`, `email citext`, `nome`, `papel`, `cpf_hash`, `token_hash` único, `status` `pendente|aceito|revogado`, `tentativas`, `expira_em`, `aceito_em`, `usuario_id`, `criado_por_id`, `criado_em`, `atualizado_em`), um pendente por (conta, e-mail). `criado_por_id` é FK simples (super_admin não tem conta). Migration 0016 por `pnpm db:generate:rh -- --name convites_usuario`; SQL manual (trigger, grants) em outra, no padrão da 0015.
- Um service só, usado pelas duas portas (`modules/invites/` e `modules/super-admin/invites/`). A chave do HMAC do CPF entra pelas deps (`container.ts`, `deps.ts`, harness).
- `employees/routes.ts`: criar, editar e desligar passam a valer para `rh` **e** `admin`. Vínculos seguem só `rh`. Ajuste testes e a matriz da `04` (§1.4 e §7.1) e registre o termo no glossário (`database.md` §12).
- Inclua todas as rotas novas do super_admin (de A e de B, pelo contrato) em `test/super-admin-guard.test.ts`.

## Agente C: front

1. `lib/auth/permissions.ts`: `employee.create|edit|terminate` para `rh` e `admin`; novo `nav.users: ['admin']`.
2. `org.establishments` chama `GET /portal/establishments` (real e mock). No cadastro de colaborador, ofereça só os ativos.
3. `/admin/empresas/[id]`: seção "Empresas e estabelecimentos" (listar, criar, editar, desativar/reativar com confirmação) e seção "Convites" (listar, convidar, revogar).
4. `/rh/usuarios` (admin): a mesma seção de convites, com item no menu.
5. Ao criar o convite, mostre o link **uma vez**, com botão de copiar, e avise que a pessoa vai precisar do CPF informado.
6. Página pública `/convite`: lê o token de `location.hash` (e o remove da barra), mostra empresa, nome e papel, pede CPF, senha e confirmação, e leva ao `/login`. O CPF nunca vai para a URL nem para o cache.
7. Tipos, endpoints e mocks mínimos para tudo; trate cada `code` de erro do contrato. Poucos testes, só do que for regra.
