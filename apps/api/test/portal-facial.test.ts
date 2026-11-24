/**
 * Área 7: cadastro facial no totem (RF04). A engine é um dublê em memória que
 * imita `POST /embeddings/register`; a engine real não é tocada.
 */
import { encryptDek, generateDek, type EngineRegisterResponse } from '@genus/shared';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPin } from '../src/modules/employees/pin';
import { EngineRejectedError, EngineUnavailableError, type FacialEngineClient, type RegisterEmbeddingInput } from '../src/modules/facial/engine-client';
import { toStoredCompanyKey } from '../src/modules/facial/stored-crypto';
import { BASE_URL, PortalHarness, TEST_PEPPER, type Org } from './support/portal';
import { multipart } from './support/multipart';

class StubEngine implements FacialEngineClient {
  calls: RegisterEmbeddingInput[] = [];
  mode: 'ok' | 'reject' | 'down' = 'ok';
  async registerEmbedding(input: RegisterEmbeddingInput): Promise<EngineRegisterResponse> {
    this.calls.push(input);
    if (this.mode === 'reject') throw new EngineRejectedError('nenhum rosto: detalhe interno da engine');
    if (this.mode === 'down') throw new EngineUnavailableError('timeout');
    return {
      person_id: input.personId,
      embedding_iv: randomBytes(12).toString('hex'),
      embedding_tag: randomBytes(16).toString('hex'),
      embedding_ct: randomBytes(2048).toString('hex'),
      model_version: 'arcface_r50_v1',
      images_processed: input.images.length,
    };
  }
}

const engine = new StubEngine();
const h = new PortalHarness({ engine });
const PIN = '739251';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
let org: Org;
let kiosk: string;
let pinHash: string;

async function withKey(o: Org) {
  const k = toStoredCompanyKey(encryptDek(generateDek(), randomBytes(32).toString('hex')), 1);
  await h.client.query(
    'INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, versao_kek) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [o.tenantId, o.companyId, k.keyVersion, k.dekIv, k.dekTag, k.dekCt, k.masterKeyVersion],
  );
}

function enroll(cookie: string, fields: Record<string, string>, photos = 2, ip = '10.0.0.1') {
  const body = multipart(
    fields,
    Array.from({ length: photos }, (_, i) => ({ field: 'photos', filename: `f${i}.jpg`, mime: 'image/jpeg', data: JPEG })),
  );
  return h.app.inject({ method: 'POST', url: '/portal/facial/enrollments', remoteAddress: ip, headers: { cookie, origin: BASE_URL, ...body.headers }, payload: body.payload });
}

const fields = (cpf: string, over: Record<string, string> = {}) => ({ cpf, pin: PIN, consentAccepted: 'true', consentTextVersion: 'v1', ...over });

beforeAll(async () => {
  await h.start();
  pinHash = await hashPin(PIN, TEST_PEPPER);
  org = await h.createOrg();
  await withKey(org);
  kiosk = (await h.loginAs(org, 'rh')).cookie;
});
afterAll(() => h.stop());

describe('cadastro facial no totem', () => {
  it('CPF + PIN + consentimento: grava consentimento e embedding cifrado (origem quiosque); recadastro troca a linha', async () => {
    const emp = await h.createEmployee(org, { pinHash });
    const res = await enroll(kiosk, fields(emp.cpf));
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ employeeId: emp.id, imagesProcessed: 2, modelVersion: 'arcface_r50_v1' });
    expect(res.body).not.toContain(emp.cpf);
    expect(res.body).not.toMatch(/embedding_|dek/i);
    const call = engine.calls.at(-1)!;
    expect(call.engineTenantId).toBe(`empresa-${org.companyId}`);
    expect(call.personId).toBe(emp.id);
    const row = await h.one<{ origem: string; qtd_imagens: number; n: string }>(
      `SELECT e.origem, e.qtd_imagens, (SELECT count(*) FROM rh.consentimentos_biometricos c WHERE c.colaborador_id = e.colaborador_id) AS n
         FROM rh.embeddings_faciais e WHERE e.colaborador_id = $1`,
      [emp.id],
    );
    expect(row).toMatchObject({ origem: 'quiosque', qtd_imagens: 2, n: '1' });

    const again = await enroll(kiosk, fields(emp.cpf, { consentAccepted: 'false' }), 3);
    expect(again.statusCode).toBe(201);
    const count = await h.one<{ n: string; q: number }>('SELECT count(*) AS n, max(qtd_imagens) AS q FROM rh.embeddings_faciais WHERE colaborador_id = $1', [emp.id]);
    expect(count).toMatchObject({ n: '1', q: 3 });
    const status = await h.call(kiosk, 'POST', '/portal/facial/status', { cpf: emp.cpf });
    expect(status.json().data.enrolled).toBe(true);
  });

  it('PIN errado, CPF inexistente e CPF de outra conta dão a mesma resposta (401); depois de 5 erros, 429', async () => {
    const emp = await h.createEmployee(org, { pinHash });
    const other = await h.createOrg();
    const foreign = await h.createEmployee(other, { pinHash });
    const ip = '10.0.0.9';
    const r1 = await enroll(kiosk, fields(emp.cpf, { pin: '000111' }), 1, ip);
    const r2 = await enroll(kiosk, fields('52998224725'), 1, ip);
    const r3 = await enroll(kiosk, fields(foreign.cpf), 1, ip);
    for (const r of [r1, r2, r3]) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual(r1.json());
      expect(r.body).not.toContain(emp.cpf);
    }
    await enroll(kiosk, fields(emp.cpf, { pin: '000112' }), 1, ip);
    await enroll(kiosk, fields(emp.cpf, { pin: '000113' }), 1, ip);
    const blocked = await enroll(kiosk, fields(emp.cpf), 1, ip);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('MUITAS_TENTATIVAS');
  });

  it('sem consentimento → 409; sem chave da empresa → 409; validação → 400 sem ecoar o PIN', async () => {
    const emp = await h.createEmployee(org, { pinHash });
    const noConsent = await enroll(kiosk, fields(emp.cpf, { consentAccepted: 'false' }));
    expect(noConsent.json().code).toBe('CONSENTIMENTO_AUSENTE');
    const bad = await enroll(kiosk, fields(emp.cpf, { pin: 'abc' }));
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain('abc');
    expect((await enroll(kiosk, fields(emp.cpf), 0)).statusCode).toBe(400);
    expect((await enroll(kiosk, fields(emp.cpf), 6)).statusCode).toBe(400);

    const o = await h.createOrg();
    const e2 = await h.createEmployee(o, { pinHash });
    const rhO = (await h.loginAs(o, 'rh')).cookie;
    const noKey = await enroll(rhO, fields(e2.cpf));
    expect(noKey.statusCode).toBe(409);
    expect(noKey.json().code).toBe('CHAVE_EMPRESA_AUSENTE');
  });

  it('engine recusa → 422 e fora do ar → 503, sem repassar o texto dela', async () => {
    const emp = await h.createEmployee(org, { pinHash });
    try {
      engine.mode = 'reject';
      const rej = await enroll(kiosk, fields(emp.cpf));
      expect(rej.statusCode).toBe(422);
      expect(rej.json().code).toBe('ROSTO_NAO_PROCESSADO');
      expect(rej.body).not.toContain('detalhe interno');
      engine.mode = 'down';
      const down = await enroll(kiosk, fields(emp.cpf));
      expect(down.statusCode).toBe(503);
      expect(down.json().code).toBe('MOTOR_FACIAL_INDISPONIVEL');
    } finally {
      engine.mode = 'ok';
    }
    expect((await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.embeddings_faciais WHERE colaborador_id = $1', [emp.id])).n).toBe('0');
  });

  it('perfis: contador, gestor e colaborador → 403; rh de outro estabelecimento não acha o CPF (401)', async () => {
    const emp = await h.createEmployee(org, { pinHash });
    for (const role of ['contador', 'colaborador'] as const) {
      const { cookie } = await h.loginAs(org, role, role === 'colaborador' ? { employeeId: emp.id } : {});
      expect((await enroll(cookie, fields(emp.cpf))).statusCode, role).toBe(403);
      expect((await h.call(cookie, 'POST', '/portal/facial/status', { cpf: emp.cpf })).statusCode, role).toBe(403);
    }
    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect((await enroll(scoped, fields(emp.cpf), 1, '10.0.0.50')).statusCode).toBe(401);
    expect((await h.call(scoped, 'POST', '/portal/facial/status', { cpf: emp.cpf })).json().data.enrolled).toBe(false);
  });
});
