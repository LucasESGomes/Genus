import { createLogger } from '@genus/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { Database } from '../src/db/client';

let app: FastifyInstance | undefined;

async function appWith(query: () => Promise<unknown>): Promise<FastifyInstance> {
  app = await buildApp({
    logger: createLogger({ level: 'silent', service: 'test' }),
    pool: { query } as never,
    db: {} as Database,
    corsOrigins: [],
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('ok com o banco respondendo', async () => {
    const res = await (await appWith(async () => ({ rows: [] }))).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: 'ok', checks: { api: 'ok', database: 'ok' } } });
  });

  it('200 com database down quando o banco falha', async () => {
    const res = await (await appWith(async () => Promise.reject(new Error('fora')))).inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.checks.database).toBe('down');
  });
});

describe('GET /health/ready', () => {
  it('503 sem banco', async () => {
    const res = await (await appWith(async () => Promise.reject(new Error('fora')))).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ data: { ready: false } });
  });
});

describe('rota inexistente', () => {
  it('404 no envelope de erro', async () => {
    const res = await (await appWith(async () => ({ rows: [] }))).inject({ method: 'GET', url: '/nada' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Recurso não encontrado', code: 'NOT_FOUND' });
  });
});
