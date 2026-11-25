import { describe, expect, it, vi } from 'vitest';
import { fixedClock } from '../clock';
import { ApiError } from './errors';
import { createKioskApi, isKeyRejected, TOTEM_VERSION, type KioskKeyStore } from './kiosk';
import { createMockKioskApi, MOCK_KIOSK_CPF, MOCK_KIOSK_PIN } from './mocks/kiosk';

const store = (v: string | null): KioskKeyStore => ({ get: () => v, set: () => undefined, clear: () => undefined });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const clock = fixedClock('2026-11-21T13:00:00.000Z');

function setup(res: () => Response, key: string | null = 'gk_chave1234') {
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => res());
  const onKeyRejected = vi.fn();
  const api = createKioskApi({ fetcher: fetcher as unknown as typeof fetch, keyStore: store(key), clock, onKeyRejected });
  return { api, fetcher, onKeyRejected };
}
const headersOf = (init?: RequestInit) => init?.headers as Record<string, string>;

describe('cliente do totem', () => {
  it('envia X-Device-Key e X-Totem-Version, sem cookie, e desembrulha { data } com ids como string', async () => {
    const { api, fetcher } = setup(() => json({ data: { device: { id: 5, name: 'T' }, establishment: { id: 1, name: 'E' }, calibration: null, serverTime: 'x' } }));
    const ctx = await api.context();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/portal/totem/context');
    expect(headersOf(init)['X-Device-Key']).toBe('gk_chave1234');
    expect(headersOf(init)['X-Totem-Version']).toBe(TOTEM_VERSION);
    expect(init?.credentials).toBe('omit');
    expect(ctx.device.id).toBe('5');
    expect(ctx.establishment.id).toBe('1');
  });

  it('401 de chave recusada avisa o app; 401 de CPF/PIN do cadastro não', async () => {
    const a = setup(() => json({ error: 'x', code: 'CHAVE_APARELHO_INVALIDA' }, 401));
    await expect(a.api.context()).rejects.toMatchObject({ status: 401 });
    expect(a.onKeyRejected).toHaveBeenCalledTimes(1);

    const b = setup(() => json({ error: 'x', code: 'CPF_OU_PIN_INVALIDO' }, 401));
    await expect(b.api.enroll(new FormData())).rejects.toMatchObject({ code: 'CPF_OU_PIN_INVALIDO' });
    expect(b.onKeyRejected).not.toHaveBeenCalled();
    expect(isKeyRejected(new ApiError('unauthenticated', 401, 'CPF_OU_PIN_INVALIDO', 'x'))).toBe(false);
  });

  it('sem chave guardada nem chama a rede e avisa o app', async () => {
    const { api, fetcher, onKeyRejected } = setup(() => json({}), null);
    await expect(api.context()).rejects.toMatchObject({ status: 401 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(onKeyRejected).toHaveBeenCalled();
  });

  it('falha de rede vira ApiError network', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('failed'); });
    const api = createKioskApi({ fetcher: fetcher as unknown as typeof fetch, keyStore: store('gk_x1234567'), clock });
    await expect(api.context()).rejects.toMatchObject({ kind: 'network' });
  });

  it('punch: multipart image + deviceSequence + capturedAt em /coletor/totem/batidas, sequência sempre crescente', async () => {
    const { api, fetcher } = setup(() => json({ data: { outcome: 'registered', receiptId: 'r', jobId: '5-1', markedAt: 'm', warnings: [] } }));
    const r = await api.punch(new Blob(['x'], { type: 'image/jpeg' }));
    await api.punch(new Blob(['y'], { type: 'image/jpeg' }));
    expect(r.outcome).toBe('registered');
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/coletor/totem/batidas');
    expect(init?.method).toBe('POST');
    const form = init?.body as FormData;
    expect(form.get('capturedAt')).toBe('2026-11-21T13:00:00.000Z');
    expect(form.get('image')).toBeInstanceOf(Blob);
    const first = Number(form.get('deviceSequence'));
    const second = Number((fetcher.mock.calls[1]?.[1]?.body as FormData).get('deviceSequence'));
    expect(first).toBe(clock.now().getTime());
    expect(second).toBeGreaterThan(first);
  });

  it('CPF e PIN vão só no corpo multipart, nunca na URL', async () => {
    const { api, fetcher } = setup(() => json({ data: { enrolledAt: 'x', imagesProcessed: 3 } }));
    const form = new FormData();
    form.append('cpf', '00000000101');
    form.append('pin', '483920');
    await api.enroll(form);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe('/portal/totem/facial/enrollments');
    expect(String(url)).not.toMatch(/0000|483920|cpf|pin/i);
    expect((init?.body as FormData).get('cpf')).toBe('00000000101');
  });

  it('calibração e job usam as rotas do contrato; jobId inválido nem chega à rede', async () => {
    const { api, fetcher } = setup(() => json({ data: { status: 'calculada' } }));
    await api.submitCalibration(new FormData());
    await api.punchJob('5-12');
    await expect(api.punchJob('../x')).rejects.toMatchObject({ kind: 'not_found' });
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual(['/portal/totem/calibration', '/coletor/totem/batidas/jobs/5-12']);
  });
});

describe('mock do totem', () => {
  const key = (v: string | null) => ({ keyStore: store(v), clock });
  it('aceita só chaves gk_demo', async () => {
    await expect(createMockKioskApi(key('gk_demo_abc')).context()).resolves.toMatchObject({ establishment: { name: 'Fazenda Boa Vista' } });
    await expect(createMockKioskApi(key('gk_outra')).context()).rejects.toMatchObject({ status: 401 });
  });

  it('cadastro: CPF 00000000101 + PIN 483920 funciona; qualquer outro par dá o erro genérico', async () => {
    const api = createMockKioskApi(key('gk_demo_abc'));
    const form = (cpf: string, pin: string) => {
      const f = new FormData();
      f.append('cpf', cpf);
      f.append('pin', pin);
      f.append('consentAccepted', 'true');
      f.append('photos', new Blob(['x']), 'a.jpg');
      return f;
    };
    await expect(api.enroll(form(MOCK_KIOSK_CPF, MOCK_KIOSK_PIN))).resolves.toMatchObject({ imagesProcessed: 1 });
    await expect(api.enroll(form(MOCK_KIOSK_CPF, '000000'))).rejects.toMatchObject({ code: 'CPF_OU_PIN_INVALIDO' });
    await expect(api.enroll(form('11111111111', MOCK_KIOSK_PIN))).rejects.toMatchObject({ code: 'CPF_OU_PIN_INVALIDO' });
  });

  it('batida devolve o nome de um colaborador do seed', async () => {
    const r = await createMockKioskApi(key('gk_demo_abc')).punch(new Blob(['x']));
    expect(r).toMatchObject({ outcome: 'registered', employeeFirstName: 'João' });
  });
});
