# Portal do RH (Next.js standalone). Build da raiz: docker build -f apps/portal/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json eslint.config.js ./
COPY apps/portal/package.json apps/portal/
RUN pnpm install --frozen-lockfile --filter @genus/portal...
COPY apps/portal apps/portal
ARG NEXT_PUBLIC_USE_MOCKS=true
# Os rewrites (/portal, /auth, /auth/whoami → api; /coletor → api do coletor) são fixados no build do Next:
# os endereços internos do compose precisam vir como argumento de build, não só como env de runtime.
ARG API_URL=http://api:3002
ARG COLLECTOR_URL=http://collector-api:3001
ENV NEXT_PUBLIC_USE_MOCKS=$NEXT_PUBLIC_USE_MOCKS NEXT_TELEMETRY_DISABLED=1 API_URL=$API_URL COLLECTOR_URL=$COLLECTOR_URL
RUN pnpm --filter @genus/portal build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/portal/.next/standalone ./
COPY --from=build /repo/apps/portal/.next/static ./apps/portal/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/portal/server.js"]
