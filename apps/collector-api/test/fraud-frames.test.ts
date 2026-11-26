/**
 * Imagens de tentativa de fraude (`liveness_failed`): cifradas em disco, idempotentes e
 * sem nunca mudar a resposta da batida.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptFraudFrame } from '../src/modules/punches/fraud-frame-store';
import { createAppTestDatabase, seedDevice, type AppTestDatabase } from './support/app-db';
import { startEngineStub, type EngineStub } from './support/engine-stub';
import {
  createTestApp,
  ENGINE_API_KEY,
  JPEG,
  MASTER_KEY,
  multipartBody,
  postPunch,
  SERVER_NOW,
  type TestApp,
} from './support/harness';

const KEY = 'gk_' + 'f'.repeat(40);

let arp: ArpTestDatabase;
let app: AppTestDatabase;
let stub: EngineStub;
let t: TestApp | undefined;

beforeAll(async () => {
  arp = await startArpTestDatabase();
  app = await createAppTestDatabase(arp);
  stub = await startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY });
}, 120_000);

afterAll(async () => {
  await stub.close();
  await app.stop();
  await arp.stop();
});

beforeEach(() => {
  stub.setBehavior({ status: 'liveness_failed' });
});

afterEach(async () => {
  const dir = t?.env.fraudFramesDir;
  await t?.close();
  t = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function start(env: Record<string, string> = {}): Promise<TestApp> {
  t = await createTestApp({ collectorUrl: arp.collectorUrl, engineUrl: stub.url, env });
  return t;
}

const folder = (a: TestApp, tenantId = 1) => path.join(a.env.fraudFramesDir, String(tenantId), SERVER_NOW.slice(0, 10));
const EXPECTED = { outcome: 'fallback_required', reason: 'liveness_failed', warnings: [] };

describe('imagem de tentativa de fraude', () => {
  it('grava a imagem cifrada e os metadados; o reenvio não regrava', async () => {
    const a = await start();
    const res = await postPunch(a, { deviceSequence: 5 });
    expect(res.json().data).toEqual(EXPECTED);

    expect((await readdir(folder(a))).sort()).toEqual(['100-5.jpg.enc', '100-5.json']);
    const encrypted = await readFile(path.join(folder(a), '100-5.jpg.enc'));
    expect(encrypted.includes(JPEG)).toBe(false);
    expect(decryptFraudFrame(encrypted, MASTER_KEY).equals(JPEG)).toBe(true);
    expect(() => decryptFraudFrame(encrypted, randomBytes(32).toString('hex'))).toThrow();

    const meta = JSON.parse(await readFile(path.join(folder(a), '100-5.json'), 'utf8'));
    expect(meta).toEqual({
      tenantId: 1,
      establishmentId: 10,
      deviceId: 100,
      deviceSequence: 5,
      capturedAt: SERVER_NOW,
      receivedAt: SERVER_NOW,
      traceId: expect.any(String),
      livenessScore: 0.12,
      mime: 'image/jpeg',
      sha256: createHash('sha256').update(JPEG).digest('hex'),
      sizeBytes: JPEG.length,
    });

    expect((await postPunch(a, { deviceSequence: 5 })).json().data).toEqual(EXPECTED);
    expect(await readdir(folder(a))).toHaveLength(2);
    expect((await readFile(path.join(folder(a), '100-5.jpg.enc'))).equals(encrypted)).toBe(true);
  });

  it('vale para a rota do totem, na conta e no aparelho da chave', async () => {
    const deviceId = await seedDevice(app, { tenantId: 1, establishmentId: 10, key: KEY });
    const a = await start({ APP_READONLY_DATABASE_URL: app.readerUrl });
    const { payload, headers } = await multipartBody({ deviceSequence: 9 });
    const res = await a.app.inject({
      method: 'POST',
      url: '/coletor/totem/batidas',
      payload,
      headers: { ...headers, 'x-device-key': KEY },
    });
    expect(res.json().data).toEqual(EXPECTED);
    expect((await readdir(folder(a))).sort()).toEqual([`${deviceId}-9.jpg.enc`, `${deviceId}-9.json`]);
  });

  it('outros motivos de fallback não guardam imagem', async () => {
    stub.setBehavior({ status: 'face_not_recognized' });
    const a = await start();
    await postPunch(a);
    await expect(readdir(a.env.fraudFramesDir)).rejects.toThrow();
  });

  it('falha ao gravar não muda a resposta; o log não leva a imagem', async () => {
    const a = await start();
    // Um arquivo onde deveria haver a pasta da conta: o mkdir falha.
    await mkdir(a.env.fraudFramesDir, { recursive: true });
    await writeFile(path.join(a.env.fraudFramesDir, '1'), 'x');
    const res = await postPunch(a);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(EXPECTED);
    const failure = a.log.records().find((r) => r.event === 'fraud_frame_store_failed');
    expect(failure).toBeDefined();
    expect(a.log.text()).not.toContain(JPEG.toString('base64'));
  });
});
