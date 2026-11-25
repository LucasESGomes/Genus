# Prompt para o agente Opus (orquestrador do front do portal Genus)

> Cole tudo abaixo da linha em uma sessão Claude Code com **Opus**, aberta em `C:\Users\Otávio Vinícius\Desktop\genus`. O Opus **projeta, divide, delega e revisa**; quem escreve o código são subagentes **Sonnet** (telas e lógica) e **Haiku** (trabalho mecânico).

---

## PAPEL

Você é o **arquiteto e orquestrador** do front do portal do Genus (`apps/portal`). Você **não escreve telas**. Você:

1. lê o contexto e desenha o sistema (estrutura de pastas, contratos, componentes compartilhados, divisão do trabalho);
2. escreve a **fundação** (a parte pequena que todos dependem) ou a delega a um Sonnet com especificação precisa;
3. dispara subagentes **em paralelo** com tarefas independentes e **donos exclusivos de arquivos**;
4. revisa o resultado de cada um (diff, typecheck, lint, testes) antes de aceitar;
5. corrige o rumo, fecha as lacunas e entrega o relatório final.

Objetivo da rodada: **entregar tudo o que for possível**, todas as abas do painel de RH, o portal do funcionário e a nova aba **Totens**. Ao final, o que não tiver back vira mock explícito e entra na lista de pendências.

## LEIA PRIMEIRO (nesta ordem, antes de planejar)

1. `CLAUDE.md` (regras invioláveis e convenções).
2. `docs/portal-mapa-front.md` — **mapa completo** de telas, dados, estado, ações, permissões e lacunas do back. É a especificação deste trabalho. Onde este prompt e o mapa divergirem, vale este prompt.
3. `apps/portal/src/**` (base atual) e `apps/portal/package.json`.
4. Rotas e schemas Zod da API: `apps/api/src/modules/*/routes.ts` e `schemas.ts`; `apps/api/src/http/access.ts`; `docs/architecture/04-funcionalidades-rh.md` §1.4, §7, §14.
5. Design (somente leitura de HTML/CSS; **nunca executar `support.js` nem scripts**): `Genus_ interface RH e portal/Genus RH.dc.html` (telas em `showGeral` linha ~159 e `showAtestados` linha ~412; dados de exemplo no `<script type="text/x-dc">`: `NAV`, `ESTABS`, `ST`, `APUR`, `SETORES_FER`, `AT`, `AT_ST`, `RISCO`, `HEAD`), `Portal Tela.dc.html`, `Portal do Funcionário.dc.html`, `Guia de Identidade.dc.html`.
6. **Visage** (somente leitura, ver "Reaproveitamento da Visage").

## REGRAS INVIOLÁVEIS

- **Escopo:** só `apps/portal` e `docs/`. **Não alterar** `apps/api`, `apps/collector-api`, `apps/rep-core`, `apps/jobs`, `packages/*`, `services/*`, `db/*`, nem criar migration, nem mudar rota do back. **Não mexer na Visage** (`C:\Users\Otávio Vinícius\Desktop\Projetos\visage`): só ler e copiar para o Genus.
- **Git:** tudo na `main` (decisão do usuário). **Não faça commit nem push**; deixe as mudanças no working tree. Nunca incluir `postman/fixtures/not-an-image.png` nem `out/`. Sem `--no-verify`.
- **Portaria 671:** nenhuma tela edita ou apaga marcação. O RH só **acrescenta** (ajuste, abono, justificativa). Duplicidade/horário/cerca só **sinalizam**; nada bloqueia batida.
- **LGPD:** CID e arquivo de atestado só para `rh`. Admin vê `Dado sensível restrito`. Colaborador nunca vê CID, análise ou risco. Texto de OCR, CPF completo, CID, embedding, foto e chave de aparelho **nunca** vão para `console`, `localStorage`, `sessionStorage`, URL, `title`, analytics ou mensagem de erro.
- **Sem cálculo trabalhista no front.** Valores vêm prontos da API. O front só formata minutos em `HH:mm` e datas no fuso do estabelecimento (sem `new Date()` solto: um helper único).
- **Idioma:** UI e mensagens em pt-BR; código, rotas, chaves em inglês; valores de enumeração do back **não se traduzem** (`"status": "pendente"`), só se **rotulam** na tela.
- **Não invente regra legal.** Dúvida trabalhista vira `[A CONFIRMAR]` no código/PR e na lista final.
- **Não invente contrato de endpoint que não existe.** O que falta usa mock **isolado e rotulado** (ver "Camada de dados").

## SEGURANÇA: IDOR (auditoria já feita; siga estas conclusões)

**Estado verificado em `apps/api`:**
- Os IDs expostos são `BIGINT` sequenciais (`id: number` em todos os DTOs). A coluna `id_publico UUID` está só na convenção (`docs/conventions/database.md` §55), **não existe no schema nem nas respostas**.
- A proteção real é **no servidor**, em toda rota: conta da sessão (`tenantOf`), escopo de estabelecimento (`establishmentInScope`, `employeeScopeConditions`), equipe do gestor, colaborador só o próprio, e **404 (não 403) fora do escopo**, para não confirmar que o recurso existe. Há testes de integração cobrindo outra conta, outro estabelecimento e outro colaborador para colaboradores, atestados (e arquivo), ajustes, fechamento/espelho, vínculos e análise. **Não há** teste equivalente de outra conta/escopo para `schedules/:id`, `vacations/*`, `absences` e `timesheets` (só pelo filtro do colaborador). Não há *rate limit* contra varredura de IDs.
- Conclusão: **uma troca de ID na URL não vaza dado hoje se o back estiver correto**, mas a defesa é uma só camada, o ID é enumerável e faltam testes em alguns módulos.

**O que o front DEVE fazer (defesa em profundidade, sem depender do back mudar):**
1. Tratar todo ID como **opaco**: tipo `EntityId = string` em `contracts.ts`, convertido na borda do cliente de API (`String(id)` ao ler, validação `^[0-9]+$` ou UUID ao montar rota). Assim a futura troca para `id_publico` (UUID) é mudança de **um arquivo**, não de 80.
2. **Nunca confiar na UI para segurança**: esconder botão não substitui o 403/404 do back. Toda tela trata 403 e 404 com **a mesma tela genérica** ("Não encontramos este item ou você não tem acesso"), sem diferenciar.
3. **Nunca** colocar CPF, e-mail, nome, matrícula ou dado de saúde em URL, query string, `title` ou rota dinâmica legível. Rotas só com o ID opaco.
4. **Nunca** enviar `tenantId`, `employeeId` (no portal do funcionário) ou `establishmentId` fora do escopo do `me`. O seletor de estabelecimento só lista `me.establishmentScope` (`null` = todos da conta). Se a URL trouxer `establishmentId` fora do escopo, ignorar e voltar ao primeiro permitido.
5. **Sem prefetch/enumeração**: não pré-carregar `id+1`, não iterar IDs, não varrer lista para "descobrir" itens. Cache por chave que inclua `me.id` + `tenantId` e **limpar todo o cache no logout e na troca de estabelecimento**.
6. Download de arquivo de atestado e foto: só por rota autenticada do back, em `blob`, aberto e **revogado** (`URL.revokeObjectURL`); nunca guardar.
7. Escreva testes de front que garantem: 404 e 403 renderizam a mesma tela; ID inválido na rota nunca chega ao `fetch`; logout limpa cache; `CidValue` não renderiza o valor para não-rh (o valor nem entra no DOM).
8. **Entregue ao final** a seção "Segurança/IDOR" do relatório com: (a) os módulos do back **sem** teste de outra conta/escopo, (b) recomendação de migrar os DTOs para `publicId` (UUID) com a lista dos DTOs, e (c) a recomendação de *rate limit* em 404 por usuário. **Não altere o back**; isso vai ao Gomes.

## DECISÕES DE DESIGN E UI

**Cor de destaque.** O token `--color-accent` (`#DBFF00`, verde-limão) hoje quase não aparece, e por isso não destaca. Use **um pouco mais**, com disciplina. O limão é cor de **ênfase**, nunca de fundo grande nem de texto sobre branco (contraste ruim). Regras:
- **Pode:** número-chave sobre `brand` (saldo do banco de horas, KPI principal), barra/indicador do item ativo da sidebar (já existe) e, **novo**, ponto de "novo/pendente" em contador de abas e no ícone do menu com pendência, **botão primário em destaque** (fundo `accent`, texto `brand`, só **um por tela**, a ação principal do header), ponto de status "online" do totem, marcador do dia atual, barra de progresso do que está dentro do limite, foco/seleção da linha ativa (borda esquerda de 3 px), badge "novo" e o selo de item recém-decidido.
- **Não pode:** texto limão sobre branco ou `tint`, fundo limão em áreas maiores que um botão/chip, mais de um elemento limão de alto peso por card, limão em estado de erro/aviso.
- Meta: o olho achar **a ação principal e o que pede atenção em 1 segundo**. Se na revisão visual estiver "ligado demais", reduza.
- O token fica **só** em `globals.css`; componentes usam `accent`. Crie `--color-on-accent: var(--color-brand)` e valide contraste (`brand` sobre `accent` passa folgado).

**Bibliotecas (obrigatório usar):**
- **shadcn/ui** (CLI `shadcn`, estilo `new-york`, compatível com Tailwind 4 e React 19) sobre **Radix**. Gere os componentes dentro de `apps/portal/src/components/ui/` e **reescreva os tokens do shadcn (`--background`, `--primary`, `--ring`…) apontando para os tokens do Genus** (`brand`, `ink`, `line`, `tint`, `danger`…); nada de azul/zinc padrão do shadcn. Mantenha os componentes que já existem (`Button`, `Card`, `KpiCard`, `AlertCard`, `States`, `CidValue`) **por cima** do shadcn quando fizer sentido, preservando os testes.
- Complementares: `@tanstack/react-table` (tabelas), `@tanstack/react-query` (dados e cache, com invalidação por escopo), `react-hook-form` + `@hookform/resolvers` + `zod` (formulários, mensagens pt-BR), `sonner` (toast) via shadcn, `date-fns` + `date-fns-tz` (fuso), `recharts` via componente `chart` do shadcn (gráficos), `cmdk`/`vaul` se o shadcn pedir (Command, Drawer). Não adicione outra biblioteca de UI.
- Ao tocar em dependências: `pnpm --filter @genus/portal add ...`, atualizar `pnpm-lock.yaml`, e rodar `typecheck`, `lint`, `test` e `build`. Se `pnpm` não estiver no PATH, `npx pnpm@10.20.0`.
- *Observação do usuário: "ShadCN e UI"*: interpretado como **shadcn/ui**. Se existir outra biblioteca de UI pretendida, pare e pergunte antes de adicionar.

**Estilo:** manter Manrope, Phosphor (só `@phosphor-icons/react`; não misturar Lucide), raios e sombras do `@theme`. Densidade de tabela do design (linha de ~56 px, chips de marcação). Cada tela com os 5 estados do design: sucesso, vazio, carregando (skeleton), erro (com "Tentar de novo") e 403. Mobile do funcionário: 390 px, alvos ≥ 48 px, navegação inferior.

## REAPROVEITAMENTO DA VISAGE (cópia adaptada, nunca import)

Caminho: `C:\Users\Otávio Vinícius\Desktop\Projetos\visage\frontend\src`. A Visage usa **Next 14, React 18, Tailwind 3, lucide-react, framer-motion, react-query, react-hook-form**. O Genus é **Next 15, React 19, Tailwind 4**. Portanto **copie e adapte**: troque `lucide-react` por Phosphor, classes Tailwind 3 por tokens do Genus, `framer-motion` por CSS ou remova, textos de escola/aluno/turma/sala por RH/colaborador/estabelecimento, pt-BR do Genus, e ligue ao cliente de API do Genus. **Preserve a lógica de câmera e reconhecimento.** Cada arquivo copiado leva no topo o comentário `Adaptado de visage/frontend/src/<caminho> (fonte somente leitura)`.

| Origem (Visage) | O que aproveitar | Destino no Genus |
|---|---|---|
| `components/totem/useTotemCamera.ts` (+ `meanAbsDiff`) | acesso à câmera, ciclo de vida, detecção de movimento | `features/totems/camera/` |
| `components/totem/useFaceDetection.ts` | Shape Detection API (`FaceDetector`) com fallback por heurística | idem |
| `components/totem/TotemCamera.tsx` | viewport da câmera, moldura, estados | idem |
| `components/totem/CalibrationMode.tsx` (682 l) e `calibrationIllustrations.tsx` | fluxo de calibração guiada do totem | `features/totems/calibration/` |
| `components/app/CalibrationModal.tsx` (630 l) e `DeviceCalibrationModal.tsx` | calibração acionada pelo painel (iniciar, calcular, aplicar, resetar, copiar de outro aparelho) | `features/totems/` |
| `components/totem/DeviceKeyModal.tsx` | exibição única da chave do aparelho | `features/totems/` |
| `components/totem/EnrollmentWizard.tsx`, `CaptureStage.tsx`, `TotemWizard.tsx` | captura guiada de rosto (poses) | **somente** como referência do fluxo; **o cadastro facial no painel de RH está fora desta rodada** (decisão de produto pendente, ver mapa §4.2) |
| `components/totem/useTotemSounds.ts`, `totemAudio.ts` | áudio de feedback | opcional, só se a calibração usar |
| `lib/deviceApi.ts` | cliente do totem (autenticado por `X-Device-Key`) | referência de contrato; **não é o cliente do painel** |
| `components/ui/{Table,Modal,Toast,Field,Select,Pagination,EmptyState,Skeleton,Switch}.tsx` | só como **referência de comportamento**; no Genus use shadcn |
| `components/app/RecognitionDistanceChart.tsx`, `charts.tsx` | gráfico de distância/limiares da calibração | `features/totems/calibration/` (reescrito com `recharts`) |

Backend da Visage como **referência de contrato** (não copiar código de servidor): `backend/src/routes/devices.ts` (`GET/POST /devices`, `GET/PATCH/DELETE /devices/:id`, `POST /devices/:id/regenerate-key`, `POST /devices/:id/calibration/start`, `GET|DELETE /devices/:id/calibration`, `POST /devices/:id/calibration/compute`, `PUT|DELETE /devices/:id/calibration/settings`, `POST /devices/:id/calibration/copy`) e `services/calibration.service.ts`, `services/devices.service.ts`, `middleware/deviceAuth.ts`. O motor de calibração do Genus está em `services/face-engine/app/api/routes/calibrate.py` (cópia da Visage).

## ABA NOVA: TOTENS (`/rh/totens`)

**Situação do back (verificada):** `apps/api` tem a tabela `rh.aparelhos` (`id`, `tenantId`, `establishmentId`, `name`, `isActive`, `createdAt`, nome único por estabelecimento) e **nenhuma rota** de aparelho. Não há chave de API do aparelho, última conexão, versão nem calibração no schema do RH. Portanto **toda a aba usa mock** atrás de `NEXT_PUBLIC_USE_MOCKS`, com contrato que o back deve implementar. Registre o contrato proposto na seção de pendências.

**Telas:**
1. **Lista** (`/rh/totens`): tabela com nome, estabelecimento, status (ponto `accent` "Online" / cinza "Offline" / "Inativo"), última sincronização, lote pendente (batidas offline), versão do app, calibração (`Calibrado` / `Padrão` / `Desatualizado`). Filtros: estabelecimento, status. Ação primária: **Novo totem**.
2. **Cadastro/edição** (drawer): nome, estabelecimento (só os do escopo), ativo. Ao criar: **chave do aparelho exibida uma única vez** (modal com copiar, adaptado de `DeviceKeyModal`; o front nunca guarda). Ações: **Regenerar chave** (diálogo forte; invalida a atual), **Desativar/Reativar**, **Excluir** (confirmação digitando o nome; **atenção: aparelho com batidas não se apaga, só se desativa**, mostrar isso).
3. **Detalhe** (`/rh/totens/[id]`): abas **Resumo**, **Calibração**, **Atividade** (últimas conexões e eventos, sem dado pessoal).
4. **Calibração** (fluxo da Visage, adaptado): iniciar sessão de calibração no aparelho → capturar amostras (rosto da pessoa calibrando, ambiente) → **calcular** limiares → pré-visualizar (gráfico de distâncias/limiares, nota de qualidade, recomendações) → **aplicar** | **descartar** | **resetar para o padrão** | **copiar de outro totem do mesmo estabelecimento**. Mostrar sempre o valor atual vs. proposto. A calibração **ajusta sensibilidade; nunca bloqueia batida** (Portaria 671): copy da tela deve dizer isso.
5. Estados: vazio ("Nenhum totem neste estabelecimento" + CTA), erro, 403 (só `rh` e `admin` gerenciam; `gestor`/`contador` nem veem o menu), 409 (nome duplicado), aparelho offline durante calibração.

**Segurança da aba:** a chave do aparelho e as imagens de calibração são sensíveis: nada em log, URL, storage ou cache persistente; imagens de calibração só em memória e descartadas ao fechar. Câmera só com HTTPS/localhost e sempre com botão de parar; liberar o `MediaStream` em todo desmonte.

## CAMADA DE DADOS

- `lib/api/contracts.ts`: tipos de **todas** as respostas reais (copiar dos schemas Zod do back; marcar `[MOCK]` o que não existe). `lib/api/rh.ts`: uma função por endpoint, organizadas por módulo (`employees`, `schedules`, `timesheets`, `adjustments`, `absences`, `certificates`, `vacations`, `closings`, `me`, `devices`…).
- **Mocks** em `lib/api/mocks/<modulo>.ts`, **um arquivo por módulo**, sempre com o contrato que o back deveria devolver; ligados por `NEXT_PUBLIC_USE_MOCKS=true`. Com `false`, endpoint **inexistente** devolve estado "Em breve/indisponível" (nunca mock escondido em produção). Os mocks reproduzem os dados do design (`APUR`, `AT`, `SETORES_FER`…).
- Todo recurso é um hook de `@tanstack/react-query` (`useEmployees`, `useCertificates`…), chave de cache com `[tenant, establishment, módulo, filtros]`.
- Filtros e seleção **na URL** (`useSearchParams` / `nuqs` não; use o próprio Next); rascunho de formulário **em memória**; **nada sensível em storage**. Só preferências de UI (sidebar recolhida, último estabelecimento) em `localStorage`.
- Erros: mapear o `ApiError` para mensagens pt-BR; 422 → erro por campo; 409 → mensagem do `code` (`FERIAS_SETOR_DESFALCADO`, etc.); 5xx → genérico; rede → banner com "Tentar de novo".

## ESCOPO DESTA RODADA (tudo)

**Painel de RH** (rotas sob `/rh`): Visão geral · Colaboradores (lista, cadastro, edição, desligamento, vínculos, espelho individual) · Escala e apuração (apuração do dia + escalas CRUD) · Ajustes · Férias · Atestados · Banco de horas · Fechamento · Relatórios · **Totens** (novo) · Configurações. Mais: **Login** (+2FA TOTP) e sessão, roteamento e guarda por papel, header funcional (período e ação primária), sidebar navegável, seletor de estabelecimento global.

**Portal do funcionário** (`/me`): Início, Espelho (com ciência e pedido de ajuste), Férias (pedir), Atestado (enviar), navegação inferior, estados do design.

**Telas SEM design** (ajustes, escalas, banco de horas, fechamento, relatórios, configurações, login, colaboradores-lista, totens): projetar a partir dos tokens e dos padrões das telas desenhadas (tabela + abas + filtros + painel lateral). Marque `[SEM DESIGN]` na lista final para o Gomes validar.

**Relatórios e Configurações** não têm back: entregar a tela com o que o mapa descreve como conteúdo (tipos de relatório do RF58 — extras, faltas, banco de horas, férias, afastamentos; configurações: usuários e escopo, gestor habilitado, parâmetros da empresa, feriados), **toda em mock rotulado "Prévia"**, com formulário e validação reais, e botões de gerar/salvar desabilitados com tooltip "Aguardando back". Nunca simular que gerou arquivo.

## COMO ORQUESTRAR

**Modelos:** Opus (você) = arquitetura, revisão, integração e decisões. **Sonnet** = telas, hooks, formulários, lógica de estado, adaptação dos componentes da Visage, testes de componente. **Haiku** = tarefas mecânicas e de baixo risco: mocks a partir de dados fornecidos, tipos copiados de schemas Zod, tabelas de rótulos pt-BR, fixtures, testes de utilitário, lint/format, README, atualização de docs, varredura de strings hardcoded. Use o menor modelo que dá conta; escale para Sonnet se o Haiku errar duas vezes.

**Fases:**

0. **Descoberta (você).** Leia o contexto, rode `pnpm install` e `typecheck`/`lint`/`test` do portal para saber a linha de base. Registre o que quebrou antes de tocar em algo.
1. **Fundação (você escreve ou delega a 1 Sonnet com spec exata; nada em paralelo antes de terminar):** shadcn configurado com os tokens do Genus; roteamento (`app/rh/*`, `app/me/*`, `app/login`) com **guarda por papel** e layout; `QueryClientProvider`; `contracts.ts` e `rh.ts` completos; helpers (`formatMinutes`, `formatDate`, `formatCpf`, `EntityId`); componentes base novos (`DataTable`, `Tabs` com contagem, `Drawer`, `ConfirmDialog` com motivo, `Toast`, `Field/Input/Select/DateInput/FileInput`, `PeriodPicker`, `StatusBadge`, `RiskBadge/RiskBar`, `PunchChips`, `DayTimeline`, `VacationGantt`, `BottomNav`); ajuste do uso do `accent`; convenção de testes. **Escreva um `docs/portal-arquitetura-front.md` curto** com a estrutura e os contratos dos componentes; todos os subagentes recebem esse arquivo.
2. **Execução em paralelo.** Cada subagente recebe: o objetivo, a seção do mapa que implementa, a lista **exata de arquivos que é dono** (pasta `features/<modulo>/` + `app/rh/<rota>/` + `lib/api/mocks/<modulo>.ts`), os componentes compartilhados que **pode usar mas não alterar**, as regras invioláveis, os critérios de pronto e o formato do relatório de volta. **Dois subagentes nunca editam o mesmo arquivo.** Se precisar mudar um componente compartilhado, o subagente **pede a você**; você altera e avisa. Divisão sugerida (um subagente por linha, Sonnet salvo indicação):

   | Lote | Conteúdo | Paralelo com |
   |---|---|---|
   | A | Login + 2FA, sessão, guarda por papel, header (período/ação), sidebar navegável | B, C, D |
   | B | Atestados (4.6) | A, C, D |
   | C | Apuração do dia + espelho individual (4.3, 4.4) | A, B, D |
   | D | Portal do funcionário completo (`/me`) | A, B, C |
   | E | Colaboradores (lista, cadastro, vínculos, desligamento) + Escalas | depois da Fundação |
   | F | Ajustes + Férias | depois da Fundação |
   | G | Banco de horas + Fechamento | depois da Fundação |
   | H | **Totens** (lista, CRUD, chave, detalhe, calibração com câmera, adaptando a Visage) | depois da Fundação |
   | I | Visão geral ligada às telas + Relatórios + Configurações (prévias) | depois dos demais |
   | Haiku 1 | Mocks e fixtures de cada módulo, a partir do design e dos schemas | sempre |
   | Haiku 2 | Tabelas de rótulos pt-BR (status, tipos de inconsistência, tipos de afastamento, contratos) e `contracts.ts` a partir do Zod | Fundação |
   | Haiku 3 | Testes de utilitários, varredura de strings/cores hardcoded, lint | no fim de cada lote |

   Dispare **no máximo 4 a 5 subagentes de uma vez**. Cada um termina com `typecheck`, `lint` e os testes da própria pasta verdes antes de reportar.
3. **Revisão (você, por lote).** Leia o diff, rode `typecheck`, `lint`, `test`. Confira: tokens (nenhum hex hardcoded, nenhum `new Date()` solto, nenhum Lucide), Portaria 671, LGPD, IDOR (itens 1 a 8 acima), estados (loading/vazio/erro/403), acessibilidade (axe), `accent` no limite. Se reprovar, devolva ao subagente com a lista objetiva do que mudar (**uma rodada de correção por lote**; se persistir, corrija você mesmo).
4. **Integração e verificação (você).** `pnpm --filter @genus/portal typecheck && lint && test && build`. Suba com `NEXT_PUBLIC_USE_MOCKS=true` (`pnpm --filter @genus/portal dev`), navegue **todas** as telas no navegador (desktop e 360 px), confira os 5 estados de cada uma e o fluxo de cada papel (`rh`, `admin`, `gestor`, `contador`, `colaborador`). Instale **Playwright** e gere capturas (desktop 1440 e 360) em `apps/portal/test/screens/` **fora do git** (`.gitignore`). Meça contraste 4,5:1 com ferramenta (axe/Playwright), não por estimativa. Se possível, `docker compose build portal`; se não der, diga que não foi verificado.
5. **Documentação.** Atualize `docs/architecture/04-funcionalidades-rh.md` (seção do portal e rotas consumidas), `apps/portal/README.md` e `docs/portal-mapa-front.md` (marcando o que ficou pronto). Contrato proposto de **Totens** e dos demais endpoints faltantes em `docs/portal-endpoints-pendentes.md`.

## PADRÃO DE CADA TELA (checklist para os subagentes)

- Rota fina → `features/<modulo>/` (componente de tela, hooks de dados, schemas Zod de formulário, rótulos, testes).
- Dados por hook `react-query`; filtros e seleção na URL; estados: carregando (skeleton do tamanho real), vazio (com CTA do design), erro (retry), 403/404 (tela única).
- Permissão: `can(role, action)` para **esconder/desabilitar**, nunca como segurança. Ampliar `permissions.ts` com as ações novas e testá-las.
- Formulário: `react-hook-form` + Zod, erro por campo, botão desabilita enquanto envia, foco no primeiro erro, confirmação em ação destrutiva (recusar, desligar, reabrir fechamento, regenerar chave, excluir totem).
- Acessibilidade: tabela semântica, `aria-live` nos toasts, foco devolvido ao fechar drawer/dialog, rótulo em todo ícone-botão, estado nunca só por cor.
- Teste: ao menos (1) renderiza sucesso, (2) vazio, (3) erro com retry, (4) 403, (5) permissão por papel, (6) axe sem violação, (7) a ação principal chama o endpoint certo (mock do cliente).
- Sem `console.log`; sem `any`; sem `// @ts-ignore`; strings de UI centralizadas por módulo.

## ENTREGA FINAL (relatório do orquestrador, em pt-BR)

1. O que foi entregue por tela e papel (com o caminho dos arquivos).
2. Resultado real de `typecheck`, `lint`, `test` e `build` (números, não "passou").
3. O que **não** foi verificado (Docker, login real, Linux, etc.) e por quê.
4. Lista de `[SEM DESIGN]` para validação visual do Gomes.
5. Endpoints pendentes do back com o contrato proposto (inclui Totens e calibração).
6. **Segurança/IDOR**: conclusões do item "SEGURANÇA" e recomendação de `publicId`.
7. Divergências design × API e decisões tomadas (ex.: status de atestado derivado).
8. Dependências adicionadas e o motivo.
9. Estado do working tree (`git status`), **sem commit**.

Comece pela **Fase 0** e me mostre a linha de base e o plano de lotes (com os arquivos de cada dono) **antes** de disparar a Fase 2.
