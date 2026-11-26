/**
 * Totem web (docs/totem-contrato.md): aparelhos, chave `X-Device-Key`, cadastro facial pelo totem,
 * calibração e busca por texto nas listas. Engine = dublê em memória; arp real (para o 409 de batidas).
 */
import { encryptDek, generateDek, type EngineRegisterResponse } from '@genus/shared';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPin } from '../src/modules/employees/pin';
import { buildCalibrationResult, personOfCalibrationFile } from '../src/modules/devices/rules/calibration-result';
import { EngineRejectedError, EngineUnavailableError, type FacialEngineClient, type RegisterEmbeddingInput } from '../src/modules/facial/engine-client';
import { toStoredCompanyKey } from '../src/modules/facial/stored-crypto';
import { escapeLike } from '../src/http/search';
import { multipart } from './support/multipart';
import { BASE_URL, PortalHarness, TEST_PEPPER, fakeCpf, type Org } from './support/portal';

class StubEngine implements FacialEngineClient {
  mode: 'ok' | 'reject' | 'down' = 'ok';
  calibrationCalls = 0;
  async registerEmbedding(input: RegisterEmbeddingInput): Promise<EngineRegisterResponse> {
    return {
      person_id: input.personId,
      embedding_iv: randomBytes(12).toString('hex'),
      embedding_tag: randomBytes(16).toString('hex'),
      embedding_ct: randomBytes(2048).toString('hex'),
      model_version: 'arcface_r50_v1',
      images_processed: input.images.length,
    };
  }
  async calibrateRecognition() {
    this.calibrationCalls += 1;
    if (this.mode === 'reject') throw new EngineRejectedError('detalhe interno');
    if (this.mode === 'down') throw new EngineUnavailableError('timeout');
    return {
      recommended_threshold: 1.04,
      eer: 0.03,
      auc: 0.97,
      dprime: 3.2,
      confidence: 'high' as const,
      warning: null,
      recommended_profile: 'conservative' as const,
      options: [
        { profile: 'conservative' as const, profile_label: 'Conservador', threshold: 1.04, genuine_accept_rate: 0.95, impostor_reject_rate: 1, interpretation: 'Rígido' },
        { profile: 'liberal' as const, profile_label: 'Liberal', threshold: 2.7, genuine_accept_rate: 1, impostor_reject_rate: 0.8, interpretation: 'Folgado' },
      ],
      chart_data: { histogram: [{ range_start: 0.8, range_end: 0.9, genuine_count: 5, impostor_count: 0 }] },
    };
  }
  async calibrateLiveness() {
    return {
      suggested_thresholds: { liveness: 0.81 },
      liveness_analysis: { real_pass_rate: 0.95, attack_block_rate: 0.9, youden_score: 0.85, confidence: 'high' as const },
      warning: null,
    };
  }
}

const engine = new StubEngine();
const h = new PortalHarness({ engine, arp: true });
const PIN = '739251';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
let org: Org;
let rh: string;
let pinHash: string;

const api = (cookie: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown) =>
  h.app.inject({ method, url: `/portal${url}`, headers: { cookie, origin: BASE_URL }, ...(payload !== undefined ? { payload: payload as object } : {}) });

const totem = (key: string | undefined, method: 'GET' | 'POST', url: string, extra: { payload?: Buffer; headers?: Record<string, string>; ip?: string } = {}) =>
  h.app.inject({
    method,
    url: `/portal/totem${url}`,
    remoteAddress: extra.ip ?? '10.1.0.1',
    headers: { ...(key ? { 'x-device-key': key } : {}), ...extra.headers },
    ...(extra.payload ? { payload: extra.payload } : {}),
  });

async function createDevice(cookie: string, establishmentId: number, name: string) {
  const res = await api(cookie, 'POST', '/devices', { establishmentId, name });
  expect(res.statusCode).toBe(201);
  return res.json().data as { device: { id: number; keyPrefix: string }; apiKey: string };
}

const photo = (field: string, filename: string) => ({ field, filename, mime: 'image/jpeg', data: JPEG });
function calibrationBody(sessionId: number, over: { genuine?: number } = {}) {
  const g = over.genuine ?? 3;
  const files = [
    ...Array.from({ length: g }, (_, i) => photo('genuine', `p1_${i + 1}.jpg`)),
    ...Array.from({ length: g }, (_, i) => photo('genuine', `p2_${i + 1}.jpg`)),
    ...Array.from({ length: 3 }, (_, i) => photo('impostor', `x_${i + 1}.jpg`)),
    ...Array.from({ length: 2 }, (_, i) => photo('attack', `y_${i + 1}.jpg`)),
  ];
  return multipart({ sessionId: String(sessionId) }, files);
}

beforeAll(async () => {
  await h.start();
  pinHash = await hashPin(PIN, TEST_PEPPER);
  org = await h.createOrg();
  const k = toStoredCompanyKey(encryptDek(generateDek(), randomBytes(32).toString('hex')), 1);
  await h.client.query(
    'INSERT INTO rh.chaves_empresa (conta_id, empresa_id, versao_chave, dek_iv, dek_tag, dek_ct, versao_kek) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [org.tenantId, org.companyId, k.keyVersion, k.dekIv, k.dekTag, k.dekCt, k.masterKeyVersion],
  );
  rh = (await h.loginAs(org, 'rh')).cookie;
});
afterAll(() => h.stop());

describe('aparelhos: cadastro e chave', () => {
  it('cria, mostra a chave uma vez, grava só o hash e audita sem a chave', async () => {
    const { device, apiKey } = await createDevice(rh, org.establishmentId, 'Totem Portaria');
    expect(apiKey).toMatch(/^gk_[0-9a-f]{40}$/);
    expect(device.keyPrefix).toBe(apiKey.slice(0, 8));
    const row = await h.one<{ chave_hash: Buffer; chave_prefixo: string }>('SELECT chave_hash, chave_prefixo FROM rh.aparelhos WHERE id = $1', [device.id]);
    expect(row.chave_hash).toHaveLength(32);
    expect(row.chave_hash.toString('hex')).not.toContain(apiKey.slice(3));
    const audits = await h.client.query("SELECT dados_antes, dados_depois FROM rh.auditorias WHERE entidade = 'aparelhos' AND entidade_id = $1", [device.id]);
    expect(JSON.stringify(audits.rows)).not.toContain(apiKey.slice(3));
    expect(audits.rows[0].dados_depois.event).toBe('device.created');

    const get = await api(rh, 'GET', `/devices/${device.id}`);
    expect(get.json().data).toMatchObject({ connection: 'offline', calibrationState: 'padrao', hasPunches: false, pendingPunches: 0 });
    expect(get.body).not.toContain(apiKey);
    expect(get.body).not.toMatch(/hash/i);
  });

  it('nome duplicado no estabelecimento → 409 APARELHO_NOME_DUPLICADO', async () => {
    await createDevice(rh, org.establishmentId, 'Duplicado');
    const again = await api(rh, 'POST', '/devices', { establishmentId: org.establishmentId, name: 'Duplicado' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('APARELHO_NOME_DUPLICADO');
  });

  it('regenerar invalida a chave antiga e vale a nova', async () => {
    const { device, apiKey } = await createDevice(rh, org.establishmentId, 'Regenera');
    expect((await totem(apiKey, 'GET', '/context')).statusCode).toBe(200);
    const res = await api(rh, 'POST', `/devices/${device.id}/regenerate-key`);
    expect(res.statusCode).toBe(200);
    const fresh = res.json().data.apiKey as string;
    expect(fresh).not.toBe(apiKey);
    expect((await totem(apiKey, 'GET', '/context')).statusCode).toBe(401);
    expect((await totem(fresh, 'GET', '/context')).statusCode).toBe(200);
    const audits = await h.client.query("SELECT dados_depois FROM rh.auditorias WHERE entidade = 'aparelhos' AND entidade_id = $1", [device.id]);
    expect(JSON.stringify(audits.rows)).not.toContain(fresh.slice(3));
  });

  it('isolamento: outra conta e outro estabelecimento (escopo) → 404; perfis sem permissão → 403', async () => {
    const { device } = await createDevice(rh, org.establishmentId, 'Escopo');
    const other = await h.createOrg();
    const foreign = (await h.loginAs(other, 'rh')).cookie;
    expect((await api(foreign, 'GET', `/devices/${device.id}`)).statusCode).toBe(404);
    expect((await api(foreign, 'PATCH', `/devices/${device.id}`, { name: 'x1' })).statusCode).toBe(404);
    expect((await api(foreign, 'POST', '/devices', { establishmentId: org.establishmentId, name: 'Invasor' })).statusCode).toBe(404);
    expect((await api(foreign, 'GET', '/devices')).json().data).toEqual([]);

    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect((await api(scoped, 'GET', `/devices/${device.id}`)).statusCode).toBe(404);
    expect((await api(scoped, 'POST', '/devices', { establishmentId: org.establishmentId, name: 'Fora' })).statusCode).toBe(404);
    expect((await api(scoped, 'GET', '/devices')).json().data.some((d: { id: number }) => d.id === device.id)).toBe(false);

    for (const role of ['contador', 'colaborador'] as const) {
      const self = role === 'colaborador' ? await h.createEmployee(org) : null;
      const { cookie } = await h.loginAs(org, role, { employeeId: self?.id ?? null });
      expect((await api(cookie, 'GET', '/devices')).statusCode, role).toBe(403);
    }
    const admin = (await h.loginAs(org, 'admin')).cookie;
    expect((await api(admin, 'GET', `/devices/${device.id}`)).statusCode).toBe(200);
  });

  it('PATCH desativa (chave deixa de valer) e ativa; atividade lista os eventos', async () => {
    const { device, apiKey } = await createDevice(rh, org.establishmentId, 'Liga e desliga');
    const off = await api(rh, 'PATCH', `/devices/${device.id}`, { isActive: false });
    expect(off.json().data).toMatchObject({ isActive: false, connection: 'inativo' });
    expect((await totem(apiKey, 'GET', '/context')).statusCode).toBe(401);
    await api(rh, 'PATCH', `/devices/${device.id}`, { isActive: true, name: 'Liga e desliga 2' });
    expect((await totem(apiKey, 'GET', '/context')).statusCode).toBe(200);
    const act = await api(rh, 'GET', `/devices/${device.id}/activity`);
    const types = act.json().data.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['ativado', 'desativado', 'conexao']));
  });

  it('exclui sem batidas (leva eventos e sessões, mantém o consentimento); com batida no arp → 409', async () => {
    const a = await createDevice(rh, org.establishmentId, 'Descartável');
    await api(rh, 'POST', `/devices/${a.device.id}/calibration/start`);
    expect((await api(rh, 'DELETE', `/devices/${a.device.id}`)).statusCode).toBe(204);
    expect((await api(rh, 'GET', `/devices/${a.device.id}`)).statusCode).toBe(404);
    expect((await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.eventos_aparelho WHERE aparelho_id = $1', [a.device.id])).n).toBe('0');

    const b = await createDevice(rh, org.establishmentId, 'Com batida');
    const c = new pg.Client({ connectionString: h.arpDb!.collectorUrl });
    await c.connect();
    await c.query(
      `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id, cpf, marcado_em, recebido_em, metodo_identificacao)
       VALUES ($1, $2, $3, 1, 1, $4, now(), now(), 'facial')`,
      [org.tenantId, org.establishmentId, b.device.id, fakeCpf()],
    );
    await c.end();
    const del = await api(rh, 'DELETE', `/devices/${b.device.id}`);
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('APARELHO_COM_BATIDAS');
    expect((await api(rh, 'GET', `/devices/${b.device.id}`)).json().data.hasPunches).toBe(true);
  });

  it('eventos do aparelho só aceitam INSERT', async () => {
    const { device } = await createDevice(rh, org.establishmentId, 'Imutável');
    await expect(h.client.query('UPDATE rh.eventos_aparelho SET descricao = $2 WHERE aparelho_id = $1', [device.id, 'x'])).rejects.toThrow();
    await expect(h.client.query('DELETE FROM rh.eventos_aparelho WHERE aparelho_id = $1', [device.id])).rejects.toThrow();
  });
});

describe('totem: autenticação e contexto', () => {
  it('sem chave, malformada, desconhecida e inativa dão a mesma resposta 401', async () => {
    const { device, apiKey } = await createDevice(rh, org.establishmentId, 'Auth');
    await api(rh, 'PATCH', `/devices/${device.id}`, { isActive: false });
    const responses = await Promise.all([
      totem(undefined, 'GET', '/context', { ip: '10.2.0.1' }),
      totem('abc', 'GET', '/context', { ip: '10.2.0.1' }),
      totem(`gk_${'0'.repeat(40)}`, 'GET', '/context', { ip: '10.2.0.1' }),
      totem(apiKey, 'GET', '/context', { ip: '10.2.0.1' }),
    ]);
    for (const r of responses) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual(responses[0]!.json());
    }
    expect(responses[0]!.json().code).toBe('CHAVE_APARELHO_INVALIDA');
  });

  it('limita chaves inválidas por IP (429) sem afetar outro IP', async () => {
    for (let i = 0; i < 10; i++) await totem(`gk_${'1'.repeat(40)}`, 'GET', '/context', { ip: '10.3.0.1' });
    const blocked = await totem(`gk_${'1'.repeat(40)}`, 'GET', '/context', { ip: '10.3.0.1' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe('MUITAS_TENTATIVAS');
    expect((await totem(`gk_${'1'.repeat(40)}`, 'GET', '/context', { ip: '10.3.0.2' })).statusCode).toBe(401);
  });

  it('contexto: dados do aparelho, versão e última conexão; o painel mostra online; evento de conexão no máximo 1 por 10 min', async () => {
    const { device, apiKey } = await createDevice(rh, org.establishmentId, 'Contexto');
    const res = await totem(apiKey, 'GET', '/context', { headers: { 'x-totem-version': '1.2.3' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ device: { id: device.id, name: 'Contexto' }, establishment: { id: org.establishmentId, name: 'Matriz' }, calibration: null });
    await totem(apiKey, 'GET', '/context');
    await totem(apiKey, 'GET', '/context');
    const events = await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.eventos_aparelho WHERE aparelho_id = $1 AND tipo = 'conexao'", [device.id]);
    expect(events.n).toBe('1');
    const d = (await api(rh, 'GET', `/devices/${device.id}`)).json().data;
    expect(d).toMatchObject({ connection: 'online', appVersion: '1.2.3' });
    expect(d.lastSyncAt).not.toBeNull();
    const online = (await api(rh, 'GET', '/devices?connection=online')).json().data;
    expect(online.some((x: { id: number }) => x.id === device.id)).toBe(true);
    expect((await api(rh, 'GET', '/devices?connection=inativo')).json().data.some((x: { id: number }) => x.id === device.id)).toBe(false);
  });

  it('a chave não aparece em log nem a query de busca', async () => {
    const { apiKey } = await createDevice(rh, org.establishmentId, 'Log');
    await totem(apiKey, 'GET', '/context');
    await api(rh, 'GET', '/employees?q=segredinho');
    h.expectLogsWithout(apiKey, apiKey.slice(3), 'segredinho');
  });
});

describe('totem: cadastro facial', () => {
  function enroll(key: string, fields: Record<string, string>, ip = '10.4.0.1') {
    const body = multipart(fields, [photo('photos', 'a.jpg'), photo('photos', 'b.jpg'), photo('photos', 'c.jpg')]);
    return totem(key, 'POST', '/facial/enrollments', { payload: body.payload, headers: body.headers, ip });
  }
  const fields = (cpf: string, over: Record<string, string> = {}) => ({ cpf, pin: PIN, consentAccepted: 'true', consentTextVersion: 'v1', ...over });

  it('cadastra o colaborador do estabelecimento; guarda o aparelho no consentimento e o evento', async () => {
    const { device, apiKey } = await createDevice(rh, org.establishmentId, 'Cadastro');
    const emp = await h.createEmployee(org, { pinHash });
    const res = await enroll(apiKey, fields(emp.cpf));
    expect(res.statusCode).toBe(201);
    expect(res.json().data).toMatchObject({ imagesProcessed: 3 });
    expect(res.body).not.toContain(emp.cpf);
    const c = await h.one<{ aparelho_id: string; coletado_por_id: string | null }>('SELECT aparelho_id, coletado_por_id FROM rh.consentimentos_biometricos WHERE colaborador_id = $1', [emp.id]);
    expect(Number(c.aparelho_id)).toBe(device.id);
    expect(c.coletado_por_id).toBeNull();
    const ev = await h.one<{ descricao: string }>("SELECT descricao FROM rh.eventos_aparelho WHERE aparelho_id = $1 AND tipo = 'cadastro_facial'", [device.id]);
    expect(ev.descricao).not.toContain(emp.cpf);
    // apagar o aparelho com consentimento mantém o termo
    expect((await api(rh, 'DELETE', `/devices/${device.id}`)).statusCode).toBe(204);
    expect((await h.one<{ aparelho_id: string | null }>('SELECT aparelho_id FROM rh.consentimentos_biometricos WHERE colaborador_id = $1', [emp.id])).aparelho_id).toBeNull();
  });

  it('colaborador de outro estabelecimento, outra conta, PIN errado: mesma resposta 401; limite de tentativas', async () => {
    const { apiKey } = await createDevice(rh, org.establishmentId, 'Cadastro2');
    const outEst = await h.createEmployee(org, { establishmentId: org.otherEstablishmentId, pinHash });
    const wrongPin = await h.createEmployee(org, { pinHash });
    const foreignOrg = await h.createOrg();
    const foreign = await h.createEmployee(foreignOrg, { pinHash });
    const ip = '10.4.0.9';
    const rs = [await enroll(apiKey, fields(outEst.cpf), ip), await enroll(apiKey, fields(foreign.cpf), ip), await enroll(apiKey, fields(wrongPin.cpf, { pin: '000111' }), ip)];
    for (const r of rs) {
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: 'CPF ou PIN inválido', code: 'CPF_OU_PIN_INVALIDO' });
    }
    await enroll(apiKey, fields(wrongPin.cpf, { pin: '000112' }), ip);
    await enroll(apiKey, fields(wrongPin.cpf, { pin: '000113' }), ip);
    expect((await enroll(apiKey, fields(wrongPin.cpf), ip)).statusCode).toBe(429);
  });

  it('colaborador desligado → 401 genérico; sem chave → 401 CHAVE_APARELHO_INVALIDA', async () => {
    const { apiKey } = await createDevice(rh, org.establishmentId, 'Cadastro3');
    const emp = await h.createEmployee(org, { pinHash });
    await h.client.query("UPDATE rh.colaboradores SET data_desligamento = '2025-01-02', motivo_desligamento = 'teste' WHERE id = $1", [emp.id]);
    expect((await enroll(apiKey, fields(emp.cpf), '10.4.1.1')).json().code).toBe('CPF_OU_PIN_INVALIDO');
    const noKey = await totem(undefined, 'POST', '/facial/enrollments', { ip: '10.4.1.2' });
    expect(noKey.json().code).toBe('CHAVE_APARELHO_INVALIDA');
  });
});

describe('totem: conferência de CPF e PIN', () => {
  const identity = (key: string | undefined, body: { cpf: string; pin: string }, ip: string) =>
    totem(key, 'POST', '/facial/identity', { payload: Buffer.from(JSON.stringify(body)), headers: { 'content-type': 'application/json' }, ip });

  it('devolve só o primeiro nome e se já há rosto; não grava consentimento', async () => {
    const { apiKey } = await createDevice(rh, org.establishmentId, 'Identidade1');
    const emp = await h.createEmployee(org, { pinHash });
    await h.client.query("UPDATE rh.colaboradores SET nome = 'Maria de Teste' WHERE id = $1", [emp.id]);
    const res = await identity(apiKey, { cpf: emp.cpf, pin: PIN }, '10.5.0.1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { firstName: 'Maria', alreadyEnrolled: false } });
    const { rows } = await h.client.query('SELECT 1 FROM rh.consentimentos_biometricos WHERE colaborador_id = $1', [emp.id]);
    expect(rows).toHaveLength(0);

    const body = multipart({ cpf: emp.cpf, pin: PIN, consentAccepted: 'true', consentTextVersion: 'v1' }, [photo('photos', 'a.jpg')]);
    expect((await totem(apiKey, 'POST', '/facial/enrollments', { payload: body.payload, headers: body.headers, ip: '10.5.0.1' })).statusCode).toBe(201);
    expect((await identity(apiKey, { cpf: emp.cpf, pin: PIN }, '10.5.0.1')).json().data.alreadyEnrolled).toBe(true);
  });

  it('mesmo 401 para PIN errado, outro estabelecimento e desligado; limite compartilhado com o cadastro; exige a chave', async () => {
    const { apiKey } = await createDevice(rh, org.establishmentId, 'Identidade2');
    const emp = await h.createEmployee(org, { pinHash });
    const outEst = await h.createEmployee(org, { establishmentId: org.otherEstablishmentId, pinHash });
    const gone = await h.createEmployee(org, { pinHash });
    await h.client.query("UPDATE rh.colaboradores SET data_desligamento = '2025-01-02', motivo_desligamento = 'teste' WHERE id = $1", [gone.id]);
    const ip = '10.5.0.9';
    const attempts = [
      { cpf: emp.cpf, pin: '000111' },
      { cpf: outEst.cpf, pin: PIN },
      { cpf: gone.cpf, pin: PIN },
      { cpf: emp.cpf, pin: '000112' },
      { cpf: emp.cpf, pin: '000113' },
    ];
    for (const a of attempts) {
      const res = await identity(apiKey, a, ip);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'CPF ou PIN inválido', code: 'CPF_OU_PIN_INVALIDO' });
    }
    expect((await identity(apiKey, { cpf: emp.cpf, pin: PIN }, ip)).statusCode).toBe(429);
    const body = multipart({ cpf: emp.cpf, pin: PIN, consentAccepted: 'true', consentTextVersion: 'v1' }, [photo('photos', 'a.jpg')]);
    expect((await totem(apiKey, 'POST', '/facial/enrollments', { payload: body.payload, headers: body.headers, ip })).statusCode).toBe(429);
    expect((await identity(undefined, { cpf: emp.cpf, pin: PIN }, '10.5.0.2')).json().code).toBe('CHAVE_APARELHO_INVALIDA');
  });
});

describe('calibração', () => {
  async function started(name: string) {
    const d = await createDevice(rh, org.establishmentId, name);
    const s = await api(rh, 'POST', `/devices/${d.device.id}/calibration/start`);
    expect(s.statusCode).toBe(201);
    return { ...d, sessionId: s.json().data.id as number };
  }
  const submit = (key: string, sessionId: number, over: { genuine?: number } = {}) => {
    const b = calibrationBody(sessionId, over);
    return totem(key, 'POST', '/calibration', { payload: b.payload, headers: b.headers });
  };

  it('fluxo: iniciar → totem vê → enviar → calculada → aplicar; só números no banco', async () => {
    const { device, apiKey, sessionId } = await started('Calibra 1');
    expect((await api(rh, 'POST', `/devices/${device.id}/calibration/start`)).json().code).toBe('CALIBRACAO_EM_ANDAMENTO');
    expect((await totem(apiKey, 'GET', '/context')).json().data.calibration).toEqual({ sessionId, status: 'aguardando' });
    expect((await api(rh, 'GET', `/devices/${device.id}/calibration/session`)).json().data.status).toBe('aguardando');

    const res = await submit(apiKey, sessionId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ status: 'calculada' });
    expect((await totem(apiKey, 'GET', '/context')).json().data.calibration).toBeNull();

    const sess = (await api(rh, 'GET', `/devices/${device.id}/calibration/session`)).json().data;
    expect(sess.status).toBe('calculada');
    expect(sess.result).toMatchObject({
      current: { recognitionThreshold: 1.1, livenessThreshold: 0.85 },
      proposed: { recognitionThreshold: 1.04, livenessThreshold: 0.81 },
      distanceHistogram: [{ bucket: 0.8, genuine: 5, impostor: 0 }],
    });
    expect(sess.result.qualityScore).toBeGreaterThan(80);
    expect(sess.result.recommendedProfile).toBe('conservative');
    expect(sess.result.profiles).toEqual([
      { profile: 'conservative', label: 'Conservador', recognitionThreshold: 1.04, genuineAcceptRate: 0.95, impostorRejectRate: 1, interpretation: 'Rígido' },
      { profile: 'liberal', label: 'Liberal', recognitionThreshold: 2, genuineAcceptRate: 1, impostorRejectRate: 0.8, interpretation: 'Folgado' },
    ]);
    const raw = await h.one<{ resultado: unknown }>('SELECT resultado FROM rh.sessoes_calibracao WHERE id = $1', [sessionId]);
    expect(JSON.stringify(raw.resultado).length).toBeLessThan(2000);

    // reenvio da mesma sessão: já não aguarda
    expect((await submit(apiKey, sessionId)).json().code).toBe('CALIBRACAO_NAO_AGUARDANDO');

    const applied = await api(rh, 'PUT', `/devices/${device.id}/calibration/settings`, { recognitionThreshold: 1.04, livenessThreshold: 0.81 });
    expect(applied.json().data).toMatchObject({ isCalibrated: true, effectiveRecognitionThreshold: 1.04, effectiveLivenessThreshold: 0.81, calibrationSourceDeviceId: null });
    expect((await h.one<{ status: string }>('SELECT status FROM rh.sessoes_calibracao WHERE id = $1', [sessionId])).status).toBe('aplicada');
    expect((await api(rh, 'GET', `/devices/${device.id}`)).json().data.calibrationState).toBe('calibrado');
    expect((await api(rh, 'GET', `/devices/${device.id}/calibration/session`)).json().data).toBeNull();

    const reset = await api(rh, 'DELETE', `/devices/${device.id}/calibration/settings`);
    expect(reset.json().data).toMatchObject({ isCalibrated: false, recognitionThreshold: null, effectiveRecognitionThreshold: 1.1 });
  });

  it('descartar; sessão de outro aparelho = 404; poucas fotos = 400; engine: rejeita → falhou, fora do ar → 503 e segue aguardando', async () => {
    const a = await started('Calibra 2');
    const b = await started('Calibra 3');
    expect((await submit(a.apiKey, b.sessionId)).statusCode).toBe(404);
    expect((await submit(a.apiKey, a.sessionId, { genuine: 1 })).statusCode).toBe(400);

    try {
      engine.mode = 'down';
      expect((await submit(a.apiKey, a.sessionId)).statusCode).toBe(503);
      expect((await h.one<{ status: string }>('SELECT status FROM rh.sessoes_calibracao WHERE id = $1', [a.sessionId])).status).toBe('aguardando');
      engine.mode = 'reject';
      const failed = await submit(a.apiKey, a.sessionId);
      expect(failed.json().data).toEqual({ status: 'falhou' });
      expect(failed.body).not.toContain('detalhe interno');
    } finally {
      engine.mode = 'ok';
    }
    const s = (await api(rh, 'GET', `/devices/${a.device.id}/calibration/session`)).json().data;
    expect(s).toMatchObject({ status: 'falhou', result: null });
    expect(s.failureReason).toContain('Refaça');
    // falhou libera nova sessão
    expect((await api(rh, 'POST', `/devices/${a.device.id}/calibration/start`)).statusCode).toBe(201);

    expect((await api(rh, 'DELETE', `/devices/${b.device.id}/calibration/session`)).statusCode).toBe(204);
    expect((await api(rh, 'DELETE', `/devices/${b.device.id}/calibration/session`)).statusCode).toBe(404);
    expect((await h.one<{ status: string }>('SELECT status FROM rh.sessoes_calibracao WHERE id = $1', [b.sessionId])).status).toBe('descartada');
  });

  it('aparelho inativo não calibra (409); copiar: mesma filial sim, outra filial 404, origem sem calibração 409', async () => {
    const inactive = await createDevice(rh, org.establishmentId, 'Inativo cal');
    await api(rh, 'PATCH', `/devices/${inactive.device.id}`, { isActive: false });
    expect((await api(rh, 'POST', `/devices/${inactive.device.id}/calibration/start`)).json().code).toBe('APARELHO_INATIVO');

    const src = await createDevice(rh, org.establishmentId, 'Origem');
    const dst = await createDevice(rh, org.establishmentId, 'Destino');
    const far = await createDevice(rh, org.otherEstablishmentId, 'Outra filial');
    expect((await api(rh, 'POST', `/devices/${dst.device.id}/calibration/copy`, { sourceDeviceId: src.device.id })).json().code).toBe('CALIBRACAO_SEM_ORIGEM');
    await api(rh, 'PUT', `/devices/${src.device.id}/calibration/settings`, { recognitionThreshold: 0.9, livenessThreshold: 0.7 });
    const copied = await api(rh, 'POST', `/devices/${dst.device.id}/calibration/copy`, { sourceDeviceId: src.device.id });
    expect(copied.json().data).toMatchObject({ recognitionThreshold: 0.9, livenessThreshold: 0.7, calibrationSourceDeviceId: src.device.id, calibrationSourceName: 'Origem' });
    expect((await api(rh, 'POST', `/devices/${dst.device.id}/calibration/copy`, { sourceDeviceId: far.device.id })).statusCode).toBe(404);
    const foreignOrg = await h.createOrg();
    const foreignDev = await createDevice((await h.loginAs(foreignOrg, 'rh')).cookie, foreignOrg.establishmentId, 'De outra conta');
    expect((await api(rh, 'POST', `/devices/${dst.device.id}/calibration/copy`, { sourceDeviceId: foreignDev.device.id })).statusCode).toBe(404);
    // limiares fora da faixa → 400
    expect((await api(rh, 'PUT', `/devices/${dst.device.id}/calibration/settings`, { recognitionThreshold: 5, livenessThreshold: 0.7 })).statusCode).toBe(400);
    // apagar a origem solta o vínculo do destino
    expect((await api(rh, 'DELETE', `/devices/${src.device.id}`)).statusCode).toBe(204);
    expect((await api(rh, 'GET', `/devices/${dst.device.id}/calibration`)).json().data).toMatchObject({ calibrationSourceDeviceId: null, isCalibrated: true });
    // auditoria dos eventos de calibração
    const ev = await h.client.query("SELECT dados_depois->>'event' AS e FROM rh.auditorias WHERE entidade = 'aparelhos' AND entidade_id = $1", [dst.device.id]);
    expect(ev.rows.map((r) => r.e)).toEqual(expect.arrayContaining(['device.created', 'device.calibration_copied']));
  });
});

describe('regras puras da calibração', () => {
  it('pessoa pelo prefixo do arquivo; nota e limites', () => {
    expect(personOfCalibrationFile('p1_2.jpg')).toBe('p1');
    expect(personOfCalibrationFile('maria.jpg')).toBe('maria');
    const base = {
      current: { recognitionThreshold: 1.1, livenessThreshold: 0.85 },
      recognition: { recommended_threshold: 3, eer: 0.2, auc: 0.6, dprime: 1, confidence: 'low' as const, warning: 'Aviso', chart_data: { histogram: [] } },
      liveness: { suggested_thresholds: { liveness: 0.2 }, liveness_analysis: { real_pass_rate: 0.5, attack_block_rate: 0.5, youden_score: 0.1, confidence: 'high' as const }, warning: null },
    };
    const r = buildCalibrationResult(base);
    expect(r.proposed).toEqual({ recognitionThreshold: 2, livenessThreshold: 0.5 });
    expect(r.qualityScore).toBeLessThanOrEqual(60);
    expect(r.recommendations).toContain('Aviso');
    expect(r.recommendations.length).toBeGreaterThan(2);
    expect(r).not.toHaveProperty('profiles');
  });

  it('escapeLike', () => {
    expect(escapeLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});

describe('busca por texto (q)', () => {
  let tenantB: Org;
  let rhB: string;
  const names = async (cookie: string, url: string) => (await api(cookie, 'GET', url)).json().data.map((x: { name: string }) => x.name);

  beforeAll(async () => {
    const mk = async (o: Org, nome: string, matricula: string) => {
      const e = await h.createEmployee(o);
      await h.client.query('UPDATE rh.colaboradores SET nome = $2, matricula = $3 WHERE id = $1', [e.id, nome, matricula]);
      return e.id;
    };
    await mk(org, 'Zélia Buscável', 'MAT-9001');
    await mk(org, 'Ana 100% Pura', 'MAT-9002');
    await mk(org, 'Ana 100x Falsa', 'MAT-9003');
    const emp = await mk(org, 'Beto_Sublinhado', 'MAT-9004');
    tenantB = await h.createOrg();
    rhB = (await h.loginAs(tenantB, 'rh')).cookie;
    await mk(tenantB, 'Zélia Buscável Outra Conta', 'MAT-9001');
    await h.client.query(
      `INSERT INTO rh.ajustes (conta_id, colaborador_id, data, tipo, motivo, solicitado_por)
       SELECT $1, $2, '2025-03-03', 'justificativa', 'motivo teste', u.id FROM rh.usuarios u WHERE u.conta_id = $1 LIMIT 1`,
      [org.tenantId, emp],
    );
    await h.client.query(
      "INSERT INTO rh.escalas (conta_id, estabelecimento_id, nome, tipo, ciclo_tipo, carga_semanal_min) VALUES ($1, $2, 'Escala Noturna 12x36', '12x36', 'semanal', 2640)",
      [org.tenantId, org.establishmentId],
    );
  });

  it('colaboradores: nome ou matrícula, sem diferenciar maiúsculas; % e _ valem literalmente; isolamento por conta', async () => {
    expect(await names(rh, '/employees?q=zélia')).toEqual(['Zélia Buscável']);
    // Sem acento e sem caixa (unaccent, migration 0013): "zelia" e "ZÉLIA" acham "Zélia".
    expect(await names(rh, '/employees?q=zelia')).toEqual(['Zélia Buscável']);
    expect(await names(rh, '/employees?q=' + encodeURIComponent('BUSCAVEL'))).toEqual(['Zélia Buscável']);
    expect(await names(rh, '/employees?q=mat-9001')).toEqual(['Zélia Buscável']);
    expect(await names(rh, '/employees?q=' + encodeURIComponent('100%'))).toEqual(['Ana 100% Pura']);
    expect(await names(rh, '/employees?q=' + encodeURIComponent('o_s'))).toEqual(['Beto_Sublinhado']);
    expect(await names(rh, '/employees?q=' + encodeURIComponent('%%'))).toEqual([]);
    expect(await names(rhB, '/employees?q=Zélia')).toEqual(['Zélia Buscável Outra Conta']);
    expect((await api(rh, 'GET', '/employees?q=a')).statusCode).toBe(400);
    expect((await api(rh, 'GET', '/employees?q=' + 'x'.repeat(101))).statusCode).toBe(400);
    expect((await api(rh, 'GET', '/employees?q=%20%20')).statusCode).toBe(400);
    const total = (await api(rh, 'GET', '/employees?q=Ana')).json().meta.total;
    expect(total).toBe(2);
  });

  it('colaborador fora do escopo de estabelecimento não aparece na busca', async () => {
    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect(await names(scoped, '/employees?q=Zélia')).toEqual([]);
  });

  it('escalas e (ajustes, atestados via join) aceitam q e respeitam a conta', async () => {
    expect((await api(rh, 'GET', '/schedules?q=noturna')).json().data.map((s: { name: string }) => s.name)).toEqual(['Escala Noturna 12x36']);
    expect((await api(rhB, 'GET', '/schedules?q=noturna')).json().data).toEqual([]);
    expect((await api(rh, 'GET', '/schedules?q=a')).statusCode).toBe(400);
    for (const path of ['/adjustments', '/certificates']) {
      const hit = await api(rh, 'GET', `${path}?q=Beto`);
      expect(hit.statusCode, path).toBe(200);
      expect((await api(rhB, 'GET', `${path}?q=Beto`)).json().data, path).toEqual([]);
      expect((await api(rh, 'GET', `${path}?q=${encodeURIComponent('%%')}`)).json().data, path).toEqual([]);
    }
  });
});
