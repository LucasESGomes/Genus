import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closedPortUrl, createTestApp, ENGINE_API_KEY, MASTER_KEY, type TestApp } from './support/harness';
import { startEngineStub, type EngineStub } from './support/engine-stub';

let db: ArpTestDatabase;
let stub: EngineStub;
let t: TestApp | undefined;

beforeAll(async () => {
  db = await startArpTestDatabase();
  stub = await startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY });
}, 120_000);

afterAll(async () => {
  await stub.close();
  await db.stop();
});

afterEach(async () => {
  stub.setHealth('ok');
  await t?.close();
  t = undefined;
});

describe('health', () => {
  it('tudo de pé: /health ok e /health/ready 200, sem chave de serviço', async () => {
    t = await createTestApp({ collectorUrl: db.collectorUrl, engineUrl: stub.url });
    const health = await t.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ data: { status: 'ok', checks: { api: 'ok', database: 'ok', engine: 'ok' } } });
    const ready = await t.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ data: { ready: true } });
  });

  it('engine fora: /health 200 com engine down; /health/ready continua 200', async () => {
    t = await createTestApp({ collectorUrl: db.collectorUrl, engineUrl: await closedPortUrl() });
    const health = await t.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().data).toMatchObject({ status: 'down', checks: { database: 'ok', engine: 'down' } });
    expect((await t.app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
  });

  it('engine degraded: status degraded', async () => {
    stub.setHealth('degraded');
    t = await createTestApp({ collectorUrl: db.collectorUrl, engineUrl: stub.url });
    const health = await t.app.inject({ method: 'GET', url: '/health' });
    expect(health.json().data).toMatchObject({ status: 'degraded', checks: { engine: 'degraded' } });
  });

  it('banco fora: /health 200 com database down; /health/ready 503', async () => {
    t = await createTestApp({
      collectorUrl: db.collectorUrl.replace(/@[^/]+\//, '@127.0.0.1:1/'),
      engineUrl: stub.url,
    });
    const health = await t.app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().data).toMatchObject({ status: 'down', checks: { database: 'down', engine: 'ok' } });
    const ready = await t.app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toEqual({ data: { ready: false } });
  });
});
