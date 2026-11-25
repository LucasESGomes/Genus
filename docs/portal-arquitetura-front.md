# Arquitetura do front do portal (`apps/portal`)

Documento curto e normativo. Todo agente que escreve tela lê este arquivo **e** `docs/portal-mapa-front.md` (o mapa diz *o que* cada tela faz; este diz *como* o código se organiza). Regras invioláveis do projeto: `CLAUDE.md`.

## 1. Pastas e donos

```
src/
  app/                         Rotas finas do App Router. page.tsx só monta a tela de features/.
    layout.tsx, providers.tsx  [fundação] provedores globais
    rh/layout.tsx              [fundação] AuthGate área rh + AppShell
    me/layout.tsx              [fundação] AuthGate área me (o lote D põe a BottomNav num layout próprio dentro dela, se precisar)
    rh/<rota>/**, me/**, login/**   [lote dono]
  features/<modulo>/           [lote dono] telas, hooks do módulo, schemas de formulário, rótulos locais, testes
  components/
    ui/                        [fundação] componentes genéricos do Genus (por cima do shadcn)
    ui/shadcn/                 [fundação] gerados pelo CLI do shadcn. Não editar à mão sem falar com o orquestrador
    domain/                    [fundação] componentes de domínio compartilhados (marcações, risco, gantt, minutos)
    shell/                     [fundação → lote A] AppShell, PageHeader, nav
  lib/
    api/contracts.ts           [fundação] tipos de TODAS as respostas (copiados do Zod do back; [MOCK] = sem back)
    api/endpoints/<mod>.ts     [fundação] uma função por endpoint
    api/rh.ts                  [fundação] junta os módulos; escolhe real ou mock
    api/mocks/<mod>.ts         [lote dono] mock do módulo (hoje "Em breve" via notMocked)
    api/mocks/data/design.ts   [fundação] dados copiados do design (fonte dos mocks; não usar direto em tela)
    api/mocks/seed.ts          [fundação] colaboradores fictícios compartilhados (ids '101'…'117', '201', '202', '301'; '101' = colaborador da sessão de mock)
    api/mocks/employees.ts     [fundação: list/get] → [lote E] o resto
    query/useEmployeeDirectory.ts [fundação] nome/matrícula por employeeId (listas que só trazem o id)
    labels/index.ts            [fundação] rótulos pt-BR + tom de cada enum do back
    format/, clock*.ts, query/, session.tsx, url-state.ts, auth/  [fundação]
test/                          [fundação] setup, mock de next/navigation, renderWithSession
```

**Dono exclusivo.** Um arquivo tem um dono. Precisa mudar arquivo da fundação (contrato, endpoint, componente compartilhado, permissão)? **Peça ao orquestrador** no relatório ou por mensagem, com o diff proposto. Não edite.

## 2. Dados

- **Nunca `fetch` direto.** Tela → hook → `useApiQuery(module, params, (api, signal) => api.<mod>.<fn>(..., signal))`.
- Chave de cache: `['genus', tenantId, meId, establishmentId, module, params]` (montada pelo hook). Trocar estabelecimento remove tudo de `['genus']`; sair (`useSignOut`) limpa o cache inteiro.
- Mutação: `useApiMutation((api, vars) => api.<mod>.<fn>(vars), { invalidates: ['adjustments', 'timesheets', 'day'] })`. Invalide **tudo** que a ação muda (aprovar ajuste/atestado → apuração do dia e espelho).
- `NEXT_PUBLIC_USE_MOCKS=true` → `createMockApi()`: todos os módulos vêm de `lib/api/mocks/*`. `false` → módulos reais; os sem back lançam `ApiError` com `kind: 'unavailable'` → a tela mostra **"Em breve"** (`ComingSoonState`), nunca dado falso.
- Mock do módulo: implementa **o mesmo tipo** do endpoint (`EmployeesApi` etc.), guarda estado em memória (aprovar muda o status no mock), usa `delay`, `paginate`, `mockFail(status, code, error, details)`, `mockNotFound()`, `mockId()` de `mocks/runtime.ts`. Dados vêm de `mocks/data/design.ts` convertidos para o contrato. Erros reproduzem os do back (409 `FERIAS_SETOR_DESFALCADO`, 422 com `details`, 404 fora do escopo).
- **IDs são `EntityId` (string opaca).** O cliente converte número → string na borda (`normalizeIds`). Montar rota com `apiPath\`/portal/x/${id}\`` (valida; ID inválido vira 404 antes do fetch). Rota dinâmica: `parseRouteId(params.id)`; `null` → `NotFoundState` sem chamar a api.
- Sem prefetch de "próximo id", sem iterar IDs, sem varrer lista para descobrir itens.
- Arquivo protegido (atestado): `api.certificates.file(id)` → `Blob` → `URL.createObjectURL` → abrir → `URL.revokeObjectURL` no fechamento/desmonte. Nunca guardar.

## 3. Estado

| Onde | O quê |
|---|---|
| URL (`useUrlState`) | filtros, aba, item selecionado (ID opaco), página, período, mês. **Nunca** nome, CPF, e-mail, matrícula, texto, dado de saúde. |
| Memória (useState / react-hook-form) | rascunhos, texto colado para análise (limpar ao fechar/trocar item), chave do aparelho exibida uma vez, PIN inicial, imagens de calibração |
| `localStorage` | só preferências de UI: `genus.ui.sidebar`, `genus.ui.establishment.<tenant>.<user>` |
| `sessionStorage` | só a sessão **do mock** (`genus.mock.session`) |
| Proibido em qualquer storage, URL, `title`, `console`, erro | CPF completo, CID, OCR, embedding, foto, chave de aparelho, senha, TOTP |

## 4. Tempo e números

- Hora atual só por `useClock().now()` (`lib/clock-context.tsx`). `new Date()` sem argumento é erro de lint fora de `clock.ts`.
- `lib/format`: `formatMinutes(545) → "09:05"`, `describeMinutes` (aria-label), `formatDate(civil, 'short'|'medium'|'long'|'weekday'|'dayMonth')`, `formatInstant/formatTime(iso, tz)`, `todayCivil(clock, tz)`, `addCivilDays`, `monthRange`, `addMonths`, `formatMonth`, `formatPeriod`, `formatCpf`, `plural`, `initials`. Fuso: `DEFAULT_TZ` (`America/Sao_Paulo`) até o back mandar o do estabelecimento.
- **Sem regra trabalhista no front.** Saldos, extras, faltas, limites, "acima do limite" vêm da api. O front soma minutos que a api entregou **só para exibir total do período aberto** (mapa §4.3), nada além.

## 5. Permissões e segurança

- `can(me.role, action)` (`lib/auth/permissions.ts`) esconde/desabilita. Não é segurança: a api responde 403/404 e a tela trata.
- **403 e 404 de recurso: mesma tela** (`NotFoundState`: "Não encontramos este item ou você não tem acesso a ele"). `ForbiddenState` (403 do design) é para **tela/área inteira** que o papel não acessa.
- `tenantId` nunca sai do front. No portal do funcionário nenhuma chamada envia `employeeId`.
- `establishmentId` só do `useSession().establishment` (já filtrado pelo escopo). `establishmentParam(establishment)` dá `undefined` para "todos".
- CID: só `<CidValue role value>` (o valor nem entra no DOM para não-rh). Colaborador nunca vê CID, análise, risco.
- `<title>` fixo "Genus RH". Mensagens de erro nunca repetem dado digitado.

## 6. UI

- **shadcn/ui** em `components/ui/shadcn` (new-york, Radix), tokens do shadcn apontados para os do Genus em `globals.css`. Ícones: **só Phosphor** (`@phosphor-icons/react`). Sem Lucide, sem framer-motion, sem outra lib de UI.
- Use os componentes de `components/ui` e `components/domain` (§8). Classes só com tokens (`bg-brand`, `text-muted`, `border-line`, `bg-tint`, `text-danger`, `bg-warn-bg`…). **Nenhum hex em componente.**
- **Cor de destaque (`accent`, verde-limão).** Pode: número-chave sobre `brand`; barra do item ativo da sidebar; ponto de "novo/pendente" em contador de aba e ícone de menu; **um** botão primário em destaque por tela (`<Button variant="accent">`, texto `on-accent`); ponto "online" do totem; marcador do dia atual; barra de progresso dentro do limite; borda esquerda de 3 px da linha selecionada; badge "novo"; selo de item recém-decidido. Não pode: texto limão sobre branco/tint; fundo limão maior que botão/chip; mais de um elemento limão de alto peso por card; limão em erro/aviso.
- Cada tela tem os 5 estados: sucesso, vazio (com CTA), carregando (skeleton do tamanho real), erro (com "Tentar de novo"), 403/404. `QueryView` (§8) cobre os quatro últimos.
- Acessibilidade: tabela semântica, `aria-live` nos toasts (sonner), foco devolvido ao fechar painel/diálogo (Radix faz), rótulo em todo ícone-botão, estado nunca só por cor (ícone + texto), alvos ≥ 48 px no mobile.
- Telas sem design: padrão das desenhadas (cabeçalho `PageHeader` + abas com contagem + filtros + tabela + painel lateral). Marcar `[SEM DESIGN]` no comentário do topo do componente da tela.

## 7. Testes (Vitest + Testing Library + vitest-axe)

- `renderWithSession(<Tela />, { role, api: { modulo: { fn: vi.fn(...) } }, route: '/rh/x?aba=y', now })` de `test/render.tsx`. O resto da api cai no mock.
- `router`/`setRoute` de `test/navigation.ts` (next/navigation já está mockado no setup).
- Toda tela: (1) sucesso, (2) vazio, (3) erro com retry, (4) 403/404, (5) permissão por papel, (6) `axe` sem violação, (7) a ação principal chama o endpoint certo com o corpo certo.
- Regras: sem `any`, sem `@ts-ignore`, sem `console`, sem `new Date()` solto. Strings de UI em pt-BR, centralizadas no módulo (`features/<mod>/copy.ts` quando passar de poucas).

## 8. Componentes compartilhados (contratos)

`components/ui` (genéricos):

| Componente | Props principais | Notas |
|---|---|---|
| `Button` | `variant: 'primary'│'secondary'│'ghost'│'accent'│'danger'`, `size: 'sm'│'md'`, `icon`, `loading` | `accent` = destaque (1 por tela). `loading` desabilita e anuncia |
| `QueryView` | `query` (resultado de useApiQuery), `loading`, `isEmpty?(data)`, `empty`, `what` (ex.: "os atestados"), `children(data)` | pending → `loading`; hidden (403/404) → `NotFoundState`; unavailable → `ComingSoonState`; demais → `ErrorState` com retry; refetch com erro e dado antigo → `ErrorBanner` acima do conteúdo |
| `States` | `Skeleton`, `LoadingState`, `EmptyState`, `ErrorState`, `ForbiddenState`, `NotFoundState`, `ComingSoonState`, `ErrorBanner` | |
| `DataTable<T>` | `columns` (TanStack v8 `ColumnDef<T>`), `data`, `getRowId`, `onRowClick?`, `rowLabel?(row)`, `selectedId?`, `loadingRows?`, `empty?`, `footer?`, `caption` | `<table>` semântico; linha clicável também por teclado (Enter); selecionada com borda esquerda `accent` 3 px |
| `Pagination` | `meta: ListMeta`, `onPageChange` | "1–25 de 412" |
| `CountTabs<V>` | `items: { value, label, count?, attention? }[]`, `value`, `onChange`, `label` | `attention` = ponto `accent` |
| `SidePanel` | `open`, `onOpenChange`, `title`, `description?`, `children`, `footer?`, `width?` | Sheet do shadcn à direita; foco volta ao gatilho |
| `ConfirmDialog` | `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `tone: 'default'│'danger'`, `reason?: { label, min?, max? }`, `typeToConfirm?: string`, `onConfirm(reason?) => Promise<void>` | Botão desabilitado até motivo válido / texto digitado; mostra erro da api sem fechar |
| `Field`, `TextInput`, `TextArea`, `SelectField`, `DateInput`, `TimeInput`, `FileInput`, `CheckboxField`, `SwitchField`, `SearchInput` | `label`, `hint?`, `error?`, `required?` + props do controle | id/aria-describedby ligados; `FileInput` com `accept`, `maxBytes`, `capture?` |
| `useZodForm(schema, defaults)` + `applyApiErrors(form, error)` | react-hook-form + zodResolver | 422 `details[].path` → erro no campo; foco no primeiro erro |
| `PeriodPicker` | `value: { from, to }`, `onChange`, `presets?` | presets: este mês, mês anterior, últimos 7 dias, personalizado (usa o Clock) |
| `MonthPicker` | `value: 'AAAA-MM'`, `onChange` | anterior/próximo + rótulo "novembro de 2026" |
| `StatusBadge` | `label`, `tone` (de `lib/labels`) | ícone por tom + texto |
| `notify` | `notify.success(msg, desc?)`, `notify.error(e: ApiError)` | sonner; erro usa a mensagem já tratada do ApiError |
| `PendingBackTooltip` | `children` (botão desabilitado) | tooltip "Aguardando back" em botão de prévia |
| `KeyValueList` | `items: { label, value }[]` | `<dl>` para painéis |
| `Avatar` | `name` | iniciais, `aria-hidden` (o nome aparece ao lado) |
| `KpiCard`, `AlertCard`, `Card`, `CidValue` | (já existem) | |

`components/domain` (compartilhados entre telas):

| Componente | Props | Notas |
|---|---|---|
| `Minutes` | `value: number`, `signed?`, `emphasis?: 'none'│'warn'│'danger'` | "09:05" com `aria-label` por extenso |
| `PunchChips` | `punches: Punch[]`, `tz` | chip por marcação (HH:mm); `origin: 'tratada'` com marca "ajustada"; número ímpar de marcações → último chip tracejado "sem saída" (só exibição) |
| `DayTimeline` | `punches`, `tz`, `expected?: { start, end }` | barra 0–24 h com segmentos entre pares |
| `RiskBadge` / `RiskBar` | `level: RiskLevel`, `score: number` | o nível vem da api; nunca derivar do score |
| `VacationGantt` | `month`, `rows`, `dailyOccupancy`, `maxSimultaneous`, `today?`, `onSelect?` | régua de dias, faixa por pessoa (aprovada cheia, solicitada tracejada, recusada âmbar), dia atual com marcador `accent`, ocupação acima do limite sinalizada com ícone |
| `BottomNav` | `items: { href, label, icon }[]` | mobile, alvos ≥ 48 px, item ativo com `aria-current` |
| `ConnectionDot` | `connection: DeviceConnection` | online = ponto `accent` com contorno + texto |

## 9. Relatório de volta (todo subagente)

1. Arquivos criados/alterados (só os do seu lote). 2. Resultado real de `pnpm --filter @genus/portal typecheck`, `lint` e `test -- <pasta>` (números). 3. Pedidos de mudança em arquivos da fundação (com diff). 4. `[A CONFIRMAR]`, `[SEM DESIGN]`, divergências design × API. 5. O que não conseguiu fazer.
