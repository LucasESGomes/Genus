# syntax=docker/dockerfile:1
# Imagem da api do portal de RH. Contexto de build: a RAIZ do repositório
# (o monorepo pnpm precisa do lockfile e de packages/shared).
#   docker compose up            (serviços api e api-migrate do docker-compose.yml da raiz)
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
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter @genus/api... \
 && chown -R node:node /repo/apps/api
USER node
WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3002
# tsx roda o TypeScript direto, como nos outros apps do monorepo.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
