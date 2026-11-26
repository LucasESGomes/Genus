import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../client';
import { timeBankApi } from './time-bank';
import { timesheetsApi } from './timesheets';

/** Cliente real com um fetch falso: confere método, caminho, corpo e a leitura do envelope. */
function fake(body: unknown) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status: 200 }));
  const client = createApiClient(fetcher);
  const call = () => {
    const [url, init] = fetcher.mock.calls[0] ?? [];
    return { url, method: init?.method, body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined };
  };
  return { fetcher, call, timeBank: timeBankApi(client), timesheets: timesheetsApi(client) };
}

const meta = { page: 1, pageSize: 25, total: 1 };

describe('endpoints de apuração do dia', () => {
  it('lista o dia com os filtros e mantém meta e counts', async () => {
    const counts = { todos: 1, inconsistente: 0, falta: 0, calculada: 1 };
    const f = fake({ data: [{ employeeId: 7, punches: [{ adjustmentId: null }] }], meta, counts });
    const page = await f.timesheets.day({ date: '2026-11-21', establishmentId: '1', status: 'falta', page: 1, pageSize: 25 });
    expect(f.call()).toEqual({ url: '/portal/timesheets?date=2026-11-21&establishmentId=1&status=falta&page=1&pageSize=25', method: 'GET', body: undefined });
    expect(page).toMatchObject({ data: [{ employeeId: '7' }], meta, counts });
  });

  it('recalcula o dia do estabelecimento e devolve os ids como texto', async () => {
    const f = fake({ data: { recalculated: 3, skipped: [{ employeeId: 9, reason: 'periodo_fechado' }] } });
    await expect(f.timesheets.recalculateDay({ establishmentId: '1', date: '2026-11-21' })).resolves.toEqual({
      recalculated: 3, skipped: [{ employeeId: '9', reason: 'periodo_fechado' }],
    });
    expect(f.call()).toEqual({ url: '/portal/timesheets/recalculate', method: 'POST', body: { establishmentId: '1', date: '2026-11-21' } });
  });
});

describe('endpoints do banco de horas', () => {
  it('saldos paginados com busca', async () => {
    const f = fake({ data: [{ employeeId: 7 }], meta });
    await expect(f.timeBank.balances({ establishmentId: '1', q: 'ana', page: 2, pageSize: 25 })).resolves.toEqual({ data: [{ employeeId: '7' }], meta });
    expect(f.call().url).toBe('/portal/time-bank?establishmentId=1&q=ana&page=2&pageSize=25');
  });

  it('extrato do colaborador', async () => {
    const data = { balanceMinutes: 10, expiringIn30DaysMinutes: 0, entries: [] };
    const f = fake({ data });
    await expect(f.timeBank.byEmployee('7')).resolves.toEqual(data);
    expect(f.call().url).toBe('/portal/employees/7/time-bank');
  });

  it('sem regra devolve null', async () => {
    const f = fake({ data: null });
    await expect(f.timeBank.policy('1')).resolves.toBeNull();
    expect(f.call().url).toBe('/portal/establishments/1/time-bank-policy');
  });

  it('salva a regra com PUT e normaliza os ids', async () => {
    const body = { modality: 'individual_6m' as const, sundayWeight: '1.00', holidayWeight: '2.00', validFrom: '2026-11-01' };
    const f = fake({ data: { id: 4, establishmentId: 1, ...body, validTo: null } });
    await expect(f.timeBank.savePolicy('1', body)).resolves.toMatchObject({ id: '4', establishmentId: '1' });
    expect(f.call()).toEqual({ url: '/portal/establishments/1/time-bank-policy', method: 'PUT', body });
  });

  it('ID inválido nunca chega ao fetch', async () => {
    const f = fake({ data: null });
    await expect(f.timeBank.byEmployee('../x')).rejects.toMatchObject({ kind: 'not_found' });
    await expect(f.timeBank.policy('')).rejects.toMatchObject({ kind: 'not_found' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
