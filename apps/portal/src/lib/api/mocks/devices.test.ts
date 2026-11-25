import { beforeEach, describe, expect, it } from 'vitest';
import { completeMockCalibration, mockDevicesApi as api, resetMockDevices } from './devices';

beforeEach(() => resetMockDevices());

describe('mock de totens', () => {
  it('lista 4 totens nos estabelecimentos 1 e 2 e filtra por conexão', async () => {
    const all = await api.list({});
    expect(all).toHaveLength(4);
    expect(new Set(all.map((d) => d.establishmentId))).toEqual(new Set(['1', '2']));
    expect(all.find((d) => d.name === 'Talhão 7')?.pendingPunches).toBe(214);
    expect((await api.list({ connection: 'offline' })).map((d) => d.name)).toEqual(['Talhão 7']);
  });
  it('criar muda a próxima leitura e devolve a chave só na criação', async () => {
    const { device, apiKey } = await api.create({ establishmentId: '1', name: 'Refeitório' });
    expect(apiKey).toMatch(/^gk_[0-9a-f]{40}$/);
    expect(JSON.stringify(await api.get(device.id))).not.toContain(apiKey);
    expect((await api.list({ establishmentId: '1' })).some((d) => d.id === device.id)).toBe(true);
  });
  it('nome duplicado no estabelecimento dá 409, em outro estabelecimento não', async () => {
    await expect(api.create({ establishmentId: '1', name: ' talhão 7 ' })).rejects.toMatchObject({ status: 409, code: 'APARELHO_NOME_DUPLICADO' });
    await expect(api.create({ establishmentId: '2', name: 'Talhão 7' })).resolves.toBeDefined();
  });
  it('excluir totem com batidas dá 409; sem batidas apaga', async () => {
    await expect(api.remove('1')).rejects.toMatchObject({ status: 409, code: 'APARELHO_COM_BATIDAS' });
    await api.remove('3');
    await expect(api.get('3')).rejects.toMatchObject({ status: 404 });
  });
  it('id desconhecido dá 404', async () => {
    await expect(api.get('999')).rejects.toMatchObject({ status: 404 });
    await expect(api.calibration('999')).rejects.toMatchObject({ status: 404 });
  });
  it('desativar e reativar atualiza a conexão', async () => {
    expect((await api.update('1', { isActive: false })).connection).toBe('inativo');
    expect((await api.update('1', { isActive: true })).connection).toBe('offline');
  });
  it('a sessão nasce aguardando e vira calculada quando o totem simulado termina', async () => {
    expect(await api.calibrationSession('1')).toBeNull();
    const started = await api.startCalibration('1');
    expect(started.status).toBe('aguardando');
    expect(started.result).toBeNull();
    expect((await api.calibrationSession('1'))?.status).toBe('aguardando');
    completeMockCalibration('1');
    const done = await api.calibrationSession('1');
    expect(done?.status).toBe('calculada');
    expect(done?.result?.qualityScore).toBe(86);
    expect(done?.result?.distanceHistogram).toHaveLength(17);
    expect(done?.result?.proposed).toEqual({ recognitionThreshold: 0.95, livenessThreshold: 0.9 });
  });
  it('iniciar de novo com sessão aberta dá 409; descartar libera', async () => {
    await api.startCalibration('1');
    await expect(api.startCalibration('1')).rejects.toMatchObject({ status: 409, code: 'CALIBRACAO_EM_ANDAMENTO' });
    await api.discardCalibration('1');
    expect(await api.calibrationSession('1')).toBeNull();
    await expect(api.startCalibration('1')).resolves.toBeDefined();
  });
  it('iniciar em totem inativo dá 409', async () => {
    await expect(api.startCalibration('3')).rejects.toMatchObject({ code: 'APARELHO_INATIVO' });
  });
  it('a busca por texto filtra pelo nome, sem acento nem caixa', async () => {
    expect((await api.list({ q: 'talhao' })).map((d) => d.name)).toEqual(['Talhão 7']);
    expect(await api.list({ q: 'zzz' })).toEqual([]);
  });
  it('a chave tem 8 caracteres de prefixo no registro e nunca a chave inteira', async () => {
    const { device, apiKey } = await api.create({ establishmentId: '1', name: 'Estufa' });
    expect(apiKey).toMatch(/^gk_[0-9a-f]{40}$/);
    expect(device.keyPrefix).toBe(apiKey.slice(0, 8));
    expect(JSON.stringify(await api.get(device.id))).not.toContain(apiKey);
  });
  it('aplicar, resetar e copiar atualizam os valores e o estado', async () => {
    await api.applyCalibration('1', { recognitionThreshold: 0.95, livenessThreshold: 0.9 });
    expect((await api.get('1')).calibrationState).toBe('calibrado');
    expect((await api.calibration('1')).effectiveRecognitionThreshold).toBe(0.95);
    await api.copyCalibration('2', '1');
    expect((await api.calibration('2')).calibrationSourceName).toBe('Portaria principal');
    await api.resetCalibration('1');
    expect((await api.get('1')).calibrationState).toBe('padrao');
    expect((await api.calibration('1')).effectiveRecognitionThreshold).toBe(1.1);
  });
  it('copiar de outro estabelecimento ou de si mesmo dá 404; limiar fora da faixa dá 422', async () => {
    await expect(api.copyCalibration('1', '4')).rejects.toMatchObject({ status: 404 });
    await expect(api.copyCalibration('1', '1')).rejects.toMatchObject({ status: 404 });
    await expect(api.applyCalibration('1', { recognitionThreshold: 5, livenessThreshold: 0.9 })).rejects.toMatchObject({ status: 422 });
  });
  it('regenerar chave devolve outra chave e registra atividade', async () => {
    const a = await api.regenerateKey('1');
    const b = await api.regenerateKey('1');
    expect(a.apiKey).not.toBe(b.apiKey);
    expect((await api.activity('1'))[0]?.type).toBe('chave_regenerada');
  });
});
