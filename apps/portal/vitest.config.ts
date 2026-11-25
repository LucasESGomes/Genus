import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    // axe em tabelas grandes no jsdom passa de 5 s com a suíte inteira em paralelo.
    testTimeout: 20_000,
    environment: 'jsdom', globals: true, setupFiles: ['./test/setup.ts'], include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'] },
});
