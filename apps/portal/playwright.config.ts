import { defineConfig } from '@playwright/test';

// Capturas e contraste medido (axe) contra o portal em modo mock. Sobe o dev server se não houver um na 3000.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:3000', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: true,
    timeout: 180_000,
    env: { NEXT_PUBLIC_USE_MOCKS: 'true' },
  },
});
