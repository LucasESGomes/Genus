# syntax=docker/dockerfile:1
# Imagem dos processos Node do monorepo (apis, rep-core, jobs e os migradores).
# Contexto de build: a RAIZ do repositório (o monorepo pnpm precisa do lockfile e dos packages/).
#
#   PKG  nome do pacote no pnpm      (ex.: @genus/collector-api)
#   DIR  pasta do pacote na raiz     (ex.: apps/collector-api)
#
# Cada serviço do Compose passa os dois em `build.args`; o comando vem do próprio serviço.
# O tsx roda o TypeScript direto, como no resto do monorepo (sem etapa de build).
FROM node:24.14.1-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
WORKDIR /repo

# Só o lockfile: esta camada fica em cache enquanto as dependências não mudam.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

FROM deps AS runtime
ARG PKG
ARG DIR
ENV APP_DIR=${DIR}
COPY . .
# Instala só este pacote e as dependências dele dentro do monorepo (--filter "<pkg>...").
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "${PKG}..." \
 && mkdir -p /repo/${DIR}/data \
 && chown -R node:node /repo/${DIR}
USER node
WORKDIR /repo/${DIR}
ENV NODE_ENV=production
CMD ["node_modules/.bin/tsx", "src/server.ts"]
