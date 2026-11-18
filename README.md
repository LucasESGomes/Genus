# Genus

SaaS de **RH com ponto eletrônico REP-P** (Portaria MTP 671/2021) e reconhecimento facial. Qualquer aparelho vira coletor, o registro continua sem internet e o RH recebe apuração, escalas, atestados, banco de horas, fechamento e espelho.

> Nome definitivo do projeto antes chamado "REP-P facial da Flauzino". O motor facial vem da Visage, que **não** é modificada: aqui ele é empacotado como serviço.

## O que há neste repositório

| Pasta | Conteúdo | Estado |
|---|---|---|
| `services/face-engine/` | Motor facial (Python, FastAPI, InsightFace, liveness), cópia do pacote REP-P da Visage | Pronto |
| `bench/` | Ferramenta de benchmark de capacidade da engine (só scripts; sem dados nem chaves) | Pronto |
| `docs/` | Contexto legal, arquitetura, funcionalidades, convenções e benchmark | Em andamento |
| `apps/` | API (Fastify), portais (Next.js) e app do coletor | **A construir** |

## Por onde começar

1. [`CLAUDE.md`](CLAUDE.md): resumo do projeto, stack, regras e convenções. É o arquivo que o Claude Code lê sozinho.
2. [`docs/README.md`](docs/README.md): índice e ordem de leitura da documentação.

## Rodar o motor facial

Veja [`docs/face-engine.md`](docs/face-engine.md). Os `setup.sh`/`setup.bat` e o `README.md` dentro de `services/face-engine/` estão desatualizados; use o `Dockerfile`.

## Stack

TypeScript + Fastify (API), PostgreSQL, S3 (ou compatível), Next.js (portais), React Native/Expo (coletor), Python + FastAPI + ONNX (motor facial). Detalhes em `CLAUDE.md`.
