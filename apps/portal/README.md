# Portal do Genus (`@genus/portal`)

Front do painel de RH (`/rh`) e do portal do colaborador (`/me`). Next.js 15 (App Router), React 19, Tailwind 4, shadcn/ui (Radix), TanStack Query e Table, react-hook-form + zod, Phosphor.

- Arquitetura e regras do código: [`docs/portal-arquitetura-front.md`](../../docs/portal-arquitetura-front.md)
- Mapa de telas, dados e permissões: [`docs/portal-mapa-front.md`](../../docs/portal-mapa-front.md)
- Endpoints que o back ainda não tem (contratos propostos): [`docs/portal-endpoints-pendentes.md`](../../docs/portal-endpoints-pendentes.md)

## Rodar

```bash
pnpm install                              # da raiz
cp apps/portal/.env.example apps/portal/.env.local
pnpm --filter @genus/portal dev           # http://localhost:3000
```

`.env.local`:

| Variável | Uso |
|---|---|
| `API_URL` | origem da api do RH (o Next repassa `/portal`, `/auth` e `/me`; cookie httpOnly na mesma origem) |
| `NEXT_PUBLIC_USE_MOCKS` | `true`: tudo em mock, sem back. `false`: api real; telas sem back mostram "Em breve" |

**Modo mock (demonstração).** Qualquer senha. O papel vem do início do e-mail: `rh@exemplo.test`, `admin@…`, `gestor@…`, `contador@…`, `colaborador@…`. Com `2fa` no e-mail (ex.: `rh2fa@exemplo.test`) o login pede o código `123456`. Os dados são fictícios e copiados do design; "hoje" nos mocks é 21/11/2026.

## Verificar

```bash
pnpm --filter @genus/portal typecheck
pnpm --filter @genus/portal lint
pnpm --filter @genus/portal test          # Vitest + Testing Library + vitest-axe
pnpm --filter @genus/portal build
```

No Windows sem modo desenvolvedor, o build não gera a saída `standalone` (copiar os links do pnpm falha com EPERM); a imagem Docker (Linux) gera. `NEXT_STANDALONE=1` força.

## Estrutura

```
src/app/            rotas finas (rh/*, me/*, login)
src/features/<mod>/ telas, hooks, schemas e testes de cada módulo
src/components/     ui (genéricos sobre shadcn), domain (marcações, risco, gantt), shell (sidebar, cabeçalho)
src/lib/api/        contracts, endpoints por módulo, mocks por módulo, ids opacos, cliente
src/lib/            format (minutos, datas no fuso), clock, query, session, permissões, labels
test/               setup, mock de next/navigation, renderWithSession
```
