import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // O teste do schema sobe um Postgres no Docker (Testcontainers).
    testTimeout: 60_000,
    hookTimeout: 240_000,
    // Cada arquivo de integração sobe o próprio Postgres: com muitos em paralelo (e a stack no ar),
    // a partida dos contêineres passa do hookTimeout. Dois por vez é estável e mais rápido.
    maxWorkers: 2,
  },
});
