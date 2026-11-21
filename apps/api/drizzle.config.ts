/**
 * drizzle-kit (generate, studio). As migrations ficam em ./drizzle e são
 * aplicadas por `pnpm --filter @genus/api db:migrate` (src/db/migrate.ts),
 * nunca por `drizzle-kit push`.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  schemaFilter: ['rh'],
  // Só o studio conecta; o generate trabalha offline, comparando com o snapshot.
  dbCredentials: { url: process.env.RH_MIGRATION_DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
