import {
  healthResponseSchema,
  readyResponseSchema,
  type DependencyStatus,
  type EngineClient,
} from '@genus/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Pool } from 'pg';

export interface HealthRoutesOptions {
  pool: Pick<Pool, 'query'>;
  engine: EngineClient;
  /** Prazo do `SELECT 1`. */
  databaseTimeoutMs?: number;
}

const RANK: Record<DependencyStatus, number> = { ok: 0, degraded: 1, down: 2 };

async function checkDatabase(pool: Pick<Pool, 'query'>, timeoutMs: number): Promise<'ok' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    });
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return 'ok';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (scope, opts) => {
  const dbTimeout = opts.databaseTimeoutMs ?? 2000;
  const app = scope.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/health',
    {
      schema: {
        tags: ['Saúde'],
        summary: 'Estado da api, do Postgres e da engine',
        description: 'Sempre 200 enquanto o processo responde. `status` é o pior estado entre as dependências. A engine `degraded` (liveness desligado) faz as batidas responderem `fallback_required`.',
        response: { 200: healthResponseSchema },
      },
    },
    async () => {
    const [database, engine] = await Promise.all([
      checkDatabase(opts.pool, dbTimeout),
      opts.engine.health().catch((): DependencyStatus => 'down'),
    ]);
    const status = [database, engine].reduce<DependencyStatus>(
      (worst, s) => (RANK[s] > RANK[worst] ? s : worst),
      'ok',
    );
    return { data: { status, checks: { api: 'ok' as const, database, engine } } };
  });

  // A engine não entra: sem ela a API ainda responde `fallback_required`.
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Saúde'],
        summary: 'Pronta para receber batidas (Postgres responde)',
        description: '200 se o Postgres responde, 503 se não. A engine não entra: sem ela a api ainda responde `fallback_required`.',
        response: { 200: readyResponseSchema, 503: readyResponseSchema },
      },
    },
    async (_req, reply) => {
      const ready = (await checkDatabase(opts.pool, dbTimeout)) === 'ok';
      return reply.code(ready ? 200 : 503).send({ data: { ready } });
    },
  );
};
