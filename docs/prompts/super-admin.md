# Prompt: Super Admin (backend + frontend)

Cole o bloco abaixo numa sessão com **Opus** (coordenador). Ele delega para Sonnet e Haiku.

---

```
Você é o COORDENADOR (Opus) da funcionalidade "Super Admin" do Genus, em
C:\Users\Otávio Vinícius\Desktop\genus. Você não escreve a maior parte do código:
planeja, divide, delega (Agent tool, model "sonnet" ou "haiku"), integra e revisa.
Leia primeiro CLAUDE.md, docs/conventions/{database,backend,security-lgpd,api-testing}.md
e docs/architecture/04-funcionalidades-rh.md. Siga TUDO o que está lá (idioma: banco em
português, código em inglês; camadas rota → service → repository; Clock injetado; Pino;
sem console.log; Zod removendo campos sensíveis).

## Objetivo

O super_admin é a operação do Genus (dono do SaaS). Ele:
1. faz o CRUD das empresas-clientes (contas/tenants) e provisiona o primeiro admin de
   cada uma; a empresa cliente faz depois as próprias configurações internas (isso já
   existe no portal de RH e NÃO muda);
2. tem um painel só dele com: auditoria de todas as contas, IPs e sessões, logs de
   reconhecimento facial, estatísticas por empresa e globais, e saúde dos sistemas.

## O que já existe (não refazer, estender)

- Papel `super_admin` já existe (apps/api/src/plugins/request-context.ts, ROLES), sem
  conta (`tenantId = null`), 2FA TOTP obrigatório, sem cadastro público.
  `tenantOf(ctx)` em src/http/access.ts devolve 403 para ele de propósito.
- Criação manual hoje: apps/api/scripts/create-user.ts (rh:create-user --role super_admin).
- Tabelas: rh.contas (id, nome, ativo, criado_em), rh.empresas, rh.estabelecimentos,
  rh.aparelhos, rh.usuarios, rh.sessoes (endereco_ip, agente_usuario), rh.auditorias
  (só INSERT; usa recordAudit em src/modules/audit/audit.ts), rh.dois_fatores.
- Health atual: apps/api/src/modules/health/routes.ts (só api + banco app).
- Reconhecimento: banco `arp`, tabela `entradas` (nota_reconhecimento, status da batida),
  gravada pelo collector-api; a api do RH lê o arp com papel somente leitura.
  Só o rep-core escreve no arp.
- Filas BullMQ `punches` e `post-punch` (packages/queue; `pnpm queue:inspect` mostra o
  jeito de ler profundidade). Engine: services/face-engine (/health).
- Portal: apps/portal (Next.js + Tailwind + shadcn). lib/auth/permissions.ts diz que
  super_admin "não entra nos módulos de RH". src/app/rh/* é o portal de RH.

## Decisões já tomadas (não reabrir; se algo conflitar, pare e pergunte)

1. **Login no .env, sem senha em texto puro no banco.** Variáveis novas em
   apps/api/.env.dev.example e config/env.ts (validadas com Zod):
   `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_NAME` e `SUPER_ADMIN_PASSWORD` (ou, preferido,
   `SUPER_ADMIN_PASSWORD_HASH` no formato scrypt do Better Auth). Um bootstrap
   idempotente na subida da api (e no `pnpm setup:dev`) cria/atualiza o usuário
   super_admin via UserService. A senha do .env só é lida no bootstrap, nunca logada,
   nunca devolvida. Mudou o .env → próximo boot atualiza o hash. O 2FA continua
   obrigatório (regra existente). Nada de segredo no git; só o .example muda.
   Em produção, sem a variável: a api sobe normalmente e avisa em log (warn), sem
   criar super_admin.
2. **Super_admin NÃO lê dado de saúde nem biometria de cliente** (security-lgpd §5).
   Nada de CID, atestado, texto de OCR, embedding, foto. Os logs de reconhecimento
   mostram só metadados: conta, estabelecimento, aparelho, horário, resultado
   (reconhecido / não reconhecido / liveness falhou), nota, latência, IP. Sem nome
   completo de colaborador nem CPF: use id do colaborador e CPF mascarado.
3. **Toda ação do super_admin é auditada** em rh.auditorias (entidade/ação em inglês,
   `<domínio>.<verbo>`), e leitura de log de outra conta também deixa trilha
   (`leitura_sensivel` onde couber). Auditoria continua só-INSERT.
4. **Sem delete físico de conta.** "Excluir" empresa = `ativo = false` (suspensa) com
   motivo; sessões da conta são revogadas e o login dos usuários dela passa a recusar
   com mensagem clara. Reativar é permitido. Sem soft delete por coluna nova de
   exclusão (regra do repo: use status/ativo).
5. Rotas sob `/portal/super-admin/...` (kebab-case, inglês), guard por papel
   `super_admin` em TODA rota, e o contrário também: nenhum papel de cliente alcança
   essas rotas (teste explícito). `tenantId` de operações em outra conta vem do
   parâmetro de rota validado, nunca do corpo, e só o super_admin pode usá-lo.
6. Painel de estatísticas só com agregados (contagens, taxas, percentis). Sem
   consulta pesada em tempo real: use índices e janelas (últimas 24 h / 7 d / 30 d).

## Escopo do backend (apps/api/src/modules/super-admin/)

- `tenants`: CRUD de conta + empresa/estabelecimento inicial + primeiro usuário admin
  (convite com senha temporária mostrada uma vez, ou link de definição de senha;
  siga o padrão do UserService). Listagem paginada com busca, filtro por status,
  contagens (colaboradores, aparelhos, usuários). Suspender/reativar (decisão 4).
  Migration nova só se faltar coluna (ex.: motivo de suspensão, plano, limites);
  nomes em português conforme database.md; nunca editar migration aplicada.
- `audit`: busca em rh.auditorias de TODAS as contas (filtros: conta, usuário,
  entidade, ação, período; paginação por cursor). Dados antes/depois já vêm
  redigidos; mantenha assim.
- `access-logs`: IPs e sessões (rh.sessoes: ip, user agent, criado/expira), logins
  recentes, IPs com muitas falhas/contas diferentes (sinalizar, não bloquear).
  Revogar sessão de um usuário (auditado).
- `recognition-logs`: leitura somente-leitura do arp.entradas (e status da fila)
  por conta/estabelecimento/aparelho/período; resumo de taxa de reconhecimento,
  liveness falho, nota média, latência. Respeitar a decisão 2.
- `stats`: visão global e por empresa: contas ativas/suspensas, colaboradores,
  aparelhos, batidas/dia, taxa de reconhecimento, pendências de fechamento, uso por
  módulo, crescimento no tempo.
- `system-health`: estado de api, Postgres (arp e app), Valkey, face-engine
  (/health), rep-core e jobs (via profundidade e idade da fila `punches`/`post-punch`
  e do outbox pendente), collector-api, versão/uptime. Cada check com timeout curto,
  resultado `ok | degraded | down` e latência. Nada de segredo na resposta.
- Swagger/OpenAPI documentado, schemas Zod de resposta removendo campos sensíveis,
  erros `{ error, code }` em pt-BR.
- Testes: Vitest por tabela nas regras puras (agregações, classificação de saúde,
  sinalização de IP) + integração com Postgres real (Testcontainers) cobrindo:
  papéis negados (admin/rh/gestor/colaborador = 403), super_admin sem 2FA = 403,
  CRUD completo, conta suspensa derruba login, auditoria gravada, bootstrap do .env
  idempotente, nenhum campo sensível nas respostas.
- Postman: requests e testes de cada endpoint novo em postman/ (api-testing.md).
- Docs: nova seção "Super Admin" em docs/architecture/04-funcionalidades-rh.md (ou
  doc próprio linkado de lá), glossário e README da api atualizados.

## Escopo do frontend (apps/portal)

- Rota própria `/admin` (grupo separado do `/rh`), com layout/shell próprio, e
  redirecionamento pós-login do super_admin para ela (ajustar lib/auth/permissions.ts
  e o gate; testes existentes continuam verdes). Usar tokens e componentes já
  existentes (components/ui, components/shell); a skill de design (frontend-design /
  ui-ux-pro-max) pode ser consultada, mas o visual segue o design system do portal.
- Páginas: Visão geral (cards de estatística + saúde resumida), Empresas (lista,
  criar, editar, suspender/reativar, detalhe com estatísticas da conta), Auditoria
  (tabela filtrável, detalhe antes/depois), Acessos e IPs, Reconhecimento (série +
  tabela, filtros), Saúde dos sistemas (cartões por serviço, atualização automática
  a cada ~15 s, estado vazio/erro/carregando), Perfil/2FA do super_admin.
- Cliente de API tipado (lib/api), estados de loading/erro/vazio em todas as telas,
  acessível (teclado, contraste), responsivo. Ações destrutivas pedem confirmação e
  motivo. Nada de dado sensível renderizado.
- Testes: Vitest/Testing Library por tela (estados + papéis) e um fluxo Playwright
  (login super_admin → criar empresa → ver na lista → suspender).

## Como coordenar (importante)

Fase 0 — você (Opus), SEM delegar: leia os arquivos acima, confira o estado real do
código (git status mostra trabalho não commitado no portal; NÃO sobrescreva nada dele,
trabalhe sobre o que está lá), e escreva um CONTRATO curto em
docs/prompts/super-admin-contrato.md: lista de endpoints, schemas Zod de request/
response (em TypeScript), nomes das tabelas/colunas novas, códigos de erro. É o único
ponto de acoplamento entre backend e frontend; ninguém muda o contrato sem passar por você.

Fase 1 — em paralelo, cada agente com arquivos próprios (nunca dois no mesmo arquivo):
  - Sonnet A: migration + schema Drizzle + bootstrap do .env + módulo `tenants`.
  - Sonnet B: módulos `audit`, `access-logs`, `recognition-logs` (leitura).
  - Sonnet C: módulos `stats` e `system-health` (+ regras puras).
  - Sonnet D: frontend: shell `/admin`, cliente de API tipado e mocks conforme o
    contrato, páginas Visão geral e Empresas.
  - Sonnet E: frontend: Auditoria, Acessos, Reconhecimento, Saúde.
  - Haiku 1: coleção Postman + docs (04, README, glossário, .env.example) a partir do
    contrato.
  - Haiku 2: rótulos/labels pt-BR, textos de estado vazio/erro, fixtures de teste.
Cada brief que você escrever deve trazer: arquivos que o agente pode tocar, o trecho
do contrato dele, as regras do CLAUDE.md que se aplicam, e "pronto quando" (typecheck,
lint e testes do pacote passando). Agentes NÃO fazem commit nem mexem em branch.

Fase 2 — integração (você): registrar as rotas no app.ts/container.ts, trocar mocks
do frontend pela api real, rodar `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
e `pnpm postman:test`; subir com Docker/`pnpm dev` e exercitar o fluxo ponta a ponta
no navegador (login com o super_admin do .env → 2FA → criar empresa → painel).

Fase 3 — revisão: um Sonnet independente (sem o contexto de quem implementou) audita
só os riscos: isolamento entre papéis, vazamento de dado sensível, auditoria faltando,
SQL sem filtro onde deveria haver, segredo em log/resposta. Corrija o que achar.

## Regras de conduta

- Não invente regra legal; use [A CONFIRMAR] e pergunte.
- Mudança de arquitetura (novo banco, nova fila, novo serviço) → pare e pergunte.
- Não toque em ../visage, nem em services/face-engine (apenas LEIA seu /health).
- Não commite .env nem segredos. Commits só no final, se eu pedir, em português
  no estilo "Área: o que mudou".
- Ao terminar, entregue: resumo do que foi feito, o que NÃO foi verificado, decisões
  que mudou e por quê, e como logar como super_admin localmente.
```

---

## Notas para você, antes de colar

- **Senha no .env:** o prompt prefere hash (`SUPER_ADMIN_PASSWORD_HASH`) em vez de texto puro. Se você quiser texto puro em dev, ele aceita, mas só lida no boot.
- **Conflito com a regra de LGPD:** `security-lgpd.md` §5 já diz que o super_admin não lê saúde nem biometria. Por isso os "logs de reconhecimento" no prompt são só metadados (nota, resultado, aparelho, IP), sem foto, embedding ou CPF completo. Se você quiser que ele veja mais que isso, é decisão sua e precisa mudar essa regra primeiro.
- **Excluir empresa** vira suspensão (`ativo = false`), porque o arp é só-INSERT e há dados fiscais ligados à conta.
- O portal tem muitas mudanças não commitadas (`git status`). O prompt manda o coordenador trabalhar em cima delas, mas vale commitar ou criar um branch antes de rodar.
