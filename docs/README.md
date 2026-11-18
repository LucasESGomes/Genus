# Documentação do Genus

## Ordem de leitura

| # | Documento | Para que serve |
|---|---|---|
| 1 | [`../CLAUDE.md`](../CLAUDE.md) | Resumo do projeto, stack, regras invioláveis e convenções. Comece aqui |
| 2 | [`architecture/01-contexto-e-portaria.md`](architecture/01-contexto-e-portaria.md) | Portaria 671/2021: o que vale para um REP-P, custos de entrada, mercado, pontos para parecer jurídico |
| 3 | [`architecture/02-arquitetura.md`](architecture/02-arquitetura.md) | Arquitetura vigente: stack, componentes, outbox, NSR e hash, tiers de infraestrutura |
| 4 | [`architecture/03-funcionalidades-e-modos.md`](architecture/03-funcionalidades-e-modos.md) | Modos do coletor (online, degradado, offline, campo), QR, portais, APIs, jobs |
| 5 | [`architecture/04-funcionalidades-rh.md`](architecture/04-funcionalidades-rh.md) | **Novo.** As 18 funcionalidades de RH do quadro do Lucidchart, encaixadas na arquitetura: tabelas, endpoints, regras, jobs, integrações, ordem de construção |
| 6 | [`conventions/database.md`](conventions/database.md) | Convenção de colunas, nomes, vigência, ledger, migrations, glossário pt-BR ↔ identificadores |
| 7 | [`conventions/backend.md`](conventions/backend.md) | Padrões de código TypeScript + Fastify: camadas, contrato HTTP, tempo, jobs, testes |
| 8 | [`conventions/security-lgpd.md`](conventions/security-lgpd.md) | Dado sensível (biometria e saúde), cifragem, acesso, retenção |
| 9 | [`face-engine.md`](face-engine.md) | O motor facial: contrato, configuração, restrições e lacunas frente ao REP-P |
| 10 | [`benchmark.md`](benchmark.md) | Metodologia, números medidos em 29/10/2026 e o que eles decidem |

## Os documentos 01, 02 e 03

Vieram do projeto anterior (`REP-P`) **sem alteração** e continuam descrevendo a arquitetura vigente. Duas observações:

- Usam **nomes em português** para as tabelas do ARP (`registros`, `evidencias`, `entrada`) e para os jobs. Os identificadores em inglês equivalentes estão em `conventions/database.md` §12.
- Chamam o produto de "REP-P facial da Flauzino (nome provisório)". O nome definitivo é **Genus**.

Os diagramas (`architecture/tiers-rep-p.drawio` e `tier1|2|3.html`) são os mesmos do projeto anterior.

## Marcadores

- **[A CONFIRMAR]**: interpretação, estimativa ou regra (trabalhista, legal, de mercado) ainda não validada na fonte.
- **[A DECIDIR]**: escolha técnica ou de produto em aberto. As decisões de `04` estão listadas em `04` §9.
- **[A MEDIR]** / **[A ATUALIZAR]**: dependem de medição.

## Quadro de funcionalidades

A fonte do documento `04` é o quadro Lucidchart "Funcionalidades do sistema de RH por painel" (lido em 18/11/2026). O quadro é uma lista sem relacionamentos; os relacionamentos e o encaixe na arquitetura são do `04`. Se o quadro mudar, atualize o `04` e o `CLAUDE.md`.
