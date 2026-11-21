import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // O teste do schema sobe um Postgres no Docker (Testcontainers).
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
