import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Pool } from 'pg';
import { healthResponseSchema, readyResponseSchema } from '../../http/contracts';

export interface HealthRoutesOptions {
  pool: Pick<Pool, 'query'>;
  /** Prazo do `SELECT 1`. */
  databaseTimeoutMs?: number;
}

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
        summary: 'Estado da api e do banco app',
        description: 'Sempre 200 enquanto o processo responde. `status` é o pior estado entre as dependências.',
        response: { 200: healthResponseSchema },
      },
    },
    async () => {
      const database = await checkDatabase(opts.pool, dbTimeout);
      return { data: { status: database, checks: { api: 'ok' as const, database } } };
    },
  );

  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Saúde'],
        summary: 'Pronta para receber requisições (Postgres responde)',
        description: '200 se o banco app responde, 503 se não.',
        response: { 200: readyResponseSchema, 503: readyResponseSchema },
      },
    },
    async (_req, reply) => {
      const ready = (await checkDatabase(opts.pool, dbTimeout)) === 'ok';
      return reply.code(ready ? 200 : 503).send({ data: { ready } });
    },
  );
};
