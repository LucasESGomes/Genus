import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Cada arquivo sobe o seu Postgres e o seu Valkey (Testcontainers): um de cada vez.
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 180000,
  },
});
