/**
 * /coletor/totem/*: batida autenticada pela chave do aparelho (X-Device-Key), sem chave de serviço.
 * Banco arp e banco app reais (Testcontainers) e o stub HTTP da engine.
 */
import { punchJobId } from '@genus/queue';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAppTestDatabase, seedCompanyKey, seedDevice, seedEmployee, type AppTestDatabase } from './support/app-db';
import { startEngineStub, type EngineStub } from './support/engine-stub';
import {
  createTestApp,
  ENGINE_API_KEY,
  MASTER_KEY,
  multipartBody,
  postPunch,
  SERVICE_KEY,
  type FormOptions,
  type TestApp,
} from './support/harness';

const KEY = 'gk_' + 'b'.repeat(40);
const OTHER_KEY = 'gk_' + 'c'.repeat(40);
const TENANT = 1;
const ESTABLISHMENT = 10;

let arp: ArpTestDatabase;
let app: AppTestDatabase;
let owner: pg.Pool;
let stub: EngineStub;
let t: TestApp | undefined;
let deviceId: number;
let otherDeviceId: number;

beforeAll(async () => {
  arp = await startArpTestDatabase();
  app = await createAppTestDatabase(arp);
  owner = new pg.Pool({ connectionString: arp.ownerUrl, max: 2 });
  stub = await startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY });
}, 120_000);

afterAll(async () => {
  await stub.close();
  await owner.end();
  await app.stop();
  await arp.stop();
});

beforeEach(async () => {
  await owner.query('DELETE FROM entradas');
  await app.admin.query('TRUNCATE rh.aparelhos, rh.colaboradores, rh.embeddings_faciais, rh.chaves_empresa');
  deviceId = await seedDevice(app, { tenantId: TENANT, establishmentId: ESTABLISHMENT, key: KEY });
  otherDeviceId = await seedDevice(app, { tenantId: TENANT, establishmentId: ESTABLISHMENT, key: OTHER_KEY });
  stub.resetCalls();
  stub.setBehavior({ status: 'identified' });
  stub.setDelay(0);
  stub.setHealth('ok');
});

afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function start(env: Record<string, string> = {}): Promise<TestApp> {
  t = await createTestApp({
    collectorUrl: arp.collectorUrl,
    engineUrl: stub.url,
    env: { APP_READONLY_DATABASE_URL: app.readerUrl, ...env },
  });
  return t;
}

async function postTotem(a: TestApp, headers: Record<string, string>, opts: FormOptions = {}) {
  const { payload, headers: form } = await multipartBody(opts);
  return a.app.inject({ method: 'POST', url: '/coletor/totem/batidas', payload, headers: { ...form, ...headers } });
}

const entries = async () => (await owner.query('SELECT aparelho_id, sequencia_aparelho FROM entradas ORDER BY id')).rows;

describe('POST /coletor/totem/batidas', () => {
  it('chave do aparelho sem chave de serviço: 200 e a batida é do aparelho da chave', async () => {
    const a = await start();
    const res = await postTotem(a, { 'x-device-key': KEY }, { deviceSequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'registered', jobId: punchJobId(deviceId, 1) });
    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].aparelho_id)).toBe(deviceId);
    expect(a.queue.published).toHaveLength(1);
  });

  it('chave errada, ausente ou de aparelho inativo: 401 CHAVE_APARELHO_INVALIDA e nada gravado', async () => {
    const a = await start();
    await seedDevice(app, { tenantId: TENANT, establishmentId: ESTABLISHMENT, key: 'gk_inativa', active: false });
    const bodies: string[] = [];
    const attempts: Record<string, string>[] = [{ 'x-device-key': 'gk_errada' }, {}, { 'x-device-key': 'gk_inativa' }];
    for (const headers of attempts) {
      const res = await postTotem(a, headers);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'Chave do aparelho inválida', code: 'CHAVE_APARELHO_INVALIDA' });
      bodies.push(res.body);
    }
    expect(new Set(bodies).size).toBe(1);
    expect(await entries()).toHaveLength(0);
    expect(stub.calls.recognize).toBe(0);
    // A chave tentada nunca vai para o log.
    expect(a.log.text()).not.toContain('gk_errada');
  });

  it('a chave de serviço não vale no totem, e a chave do aparelho não vale em /coletor/batidas', async () => {
    const a = await start();
    const withService = await postTotem(a, { 'x-service-key': SERVICE_KEY });
    expect(withService.statusCode).toBe(401);
    expect(withService.json().code).toBe('CHAVE_APARELHO_INVALIDA');

    const { payload, headers } = await multipartBody({});
    const withDeviceKey = await a.app.inject({
      method: 'POST',
      url: '/coletor/batidas',
      payload,
      headers: { ...headers, 'x-device-key': KEY },
    });
    expect(withDeviceKey.statusCode).toBe(401);
    expect(withDeviceKey.json()).toEqual({ error: 'Não autorizado', code: 'UNAUTHORIZED' });
  });

  it('a rota de serviço segue igual: chave de serviço, contexto fixo de dev', async () => {
    const a = await start();
    const res = await postPunch(a, { deviceSequence: 7 });
    expect(res.statusCode).toBe(200);
    const rows = await entries();
    expect(Number(rows[0].aparelho_id)).toBe(100);
  });

  it('o contexto vem da chave, nunca do corpo: campos de aparelho no corpo são ignorados', async () => {
    const a = await start();
    const { payload, headers } = await multipartBody({ deviceSequence: 3 });
    const res = await a.app.inject({
      method: 'POST',
      url: '/coletor/totem/batidas?deviceId=999&tenantId=999',
      payload,
      headers: { ...headers, 'x-device-key': OTHER_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(Number((await entries())[0].aparelho_id)).toBe(otherDeviceId);
  });

  it('sem APP_READONLY_DATABASE_URL o escopo do totem não existe', async () => {
    t = await createTestApp({ collectorUrl: arp.collectorUrl, engineUrl: stub.url });
    const res = await postTotem(t, { 'x-device-key': KEY });
    expect(res.statusCode).toBe(404);
  });
});

describe('limiares do aparelho', () => {
  it('envia recognition_threshold e liveness_threshold à engine quando o aparelho os tem', async () => {
    await app.admin.query('UPDATE rh.aparelhos SET limiar_reconhecimento = 0.9, limiar_vivacidade = 0.7 WHERE id = $1', [deviceId]);
    const a = await start();
    const res = await postTotem(a, { 'x-device-key': KEY }, { deviceSequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(Number(stub.calls.lastFields?.recognition_threshold)).toBeCloseTo(0.9, 5);
    expect(Number(stub.calls.lastFields?.liveness_threshold)).toBeCloseTo(0.7, 5);
  });

  it('NULL: os campos nem são enviados (vale o padrão da engine)', async () => {
    const a = await start();
    await postTotem(a, { 'x-device-key': OTHER_KEY }, { deviceSequence: 1 });
    expect(stub.calls.recognize).toBe(1);
    expect(stub.calls.lastFields).not.toBeNull();
    expect(stub.calls.lastFields).not.toHaveProperty('recognition_threshold');
    expect(stub.calls.lastFields).not.toHaveProperty('liveness_threshold');
  });
});

describe('candidatos reais (FAKE_CANDIDATES_ENABLED=false)', () => {
  const real = { FAKE_CANDIDATES_ENABLED: 'false' };

  it('reconhece entre os colaboradores do estabelecimento do aparelho', async () => {
    const dek = await seedCompanyKey(app, { tenantId: TENANT, companyId: 5, version: 1, masterKeyHex: MASTER_KEY });
    const face = { dek, companyId: 5, version: 1 };
    const ana = await seedEmployee(app, { tenantId: TENANT, establishmentId: ESTABLISHMENT, cpf: '52998224725', name: 'Ana', face });
    await seedEmployee(app, { tenantId: TENANT, establishmentId: ESTABLISHMENT, cpf: '11144477735', name: 'Bia', face });
    await seedEmployee(app, { tenantId: TENANT, establishmentId: 11, cpf: '39053344705', name: 'Outro lugar', face });

    const a = await start(real);
    const res = await postTotem(a, { 'x-device-key': KEY }, { deviceSequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.outcome).toBe('registered');
    expect(stub.calls.lastCandidateCount).toBe(2);
    const { rows } = await owner.query('SELECT colaborador_id FROM entradas');
    expect(Number(rows[0].colaborador_id)).toBe(ana);
    // CPF e nome nunca vão para o log.
    expect(a.log.text()).not.toMatch(/52998224725|11144477735|Ana|Bia/);
  });

  it('ninguém com rosto cadastrado: fallback_required, sem chamar a engine e sem gravar', async () => {
    await seedEmployee(app, { tenantId: TENANT, establishmentId: ESTABLISHMENT, cpf: '52998224725', name: 'Sem rosto' });
    const a = await start(real);
    const res = await postTotem(a, { 'x-device-key': KEY }, { deviceSequence: 1 });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ outcome: 'fallback_required', reason: 'not_recognized' });
    expect(stub.calls.recognize).toBe(0);
    expect(await entries()).toHaveLength(0);
  });

  it('exige APP_READONLY_DATABASE_URL na configuração', async () => {
    await expect(
      createTestApp({ collectorUrl: arp.collectorUrl, engineUrl: stub.url, env: real }),
    ).rejects.toThrow(/APP_READONLY_DATABASE_URL/);
  });
});

describe('GET /coletor/totem/batidas/jobs/:jobId', () => {
  it('só enxerga as batidas do próprio aparelho', async () => {
    const a = await start();
    await postTotem(a, { 'x-device-key': KEY }, { deviceSequence: 1 });
    await postTotem(a, { 'x-device-key': OTHER_KEY }, { deviceSequence: 1 });

    const own = await a.app.inject({
      method: 'GET',
      url: `/coletor/totem/batidas/jobs/${punchJobId(deviceId, 1)}`,
      headers: { 'x-device-key': KEY },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().data).toMatchObject({ jobId: punchJobId(deviceId, 1), status: 'pendente' });

    const foreign = await a.app.inject({
      method: 'GET',
      url: `/coletor/totem/batidas/jobs/${punchJobId(otherDeviceId, 1)}`,
      headers: { 'x-device-key': KEY },
    });
    expect(foreign.statusCode).toBe(404);

    const noKey = await a.app.inject({ method: 'GET', url: `/coletor/totem/batidas/jobs/${punchJobId(deviceId, 1)}` });
    expect(noKey.statusCode).toBe(401);
  });

  it('a rota de serviço continua enxergando qualquer aparelho da conta', async () => {
    const a = await start();
    await postTotem(a, { 'x-device-key': OTHER_KEY }, { deviceSequence: 1 });
    const res = await a.app.inject({
      method: 'GET',
      url: `/coletor/batidas/jobs/${punchJobId(otherDeviceId, 1)}`,
      headers: { 'x-service-key': SERVICE_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('a listagem por colaborador não existe no totem', async () => {
    const a = await start();
    const res = await a.app.inject({
      method: 'GET',
      url: '/coletor/totem/batidas?employeeId=1',
      headers: { 'x-device-key': KEY },
    });
    expect(res.statusCode).toBe(404);
  });
});
