import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { employeesApi } from './endpoints/employees';
import { apiPath, isEntityId, normalizeIds, parseRouteId } from './ids';

describe('IDs opacos (defesa contra IDOR)', () => {
  it.each(['1', '42', '9007199254740991', '0b3f6c1e-6a2b-4c3d-9e8f-0123456789ab'])('aceita %s', (v) => expect(isEntityId(v)).toBe(true));
  it.each(['', '0', '-1', '1.5', '01', 'abc', '1;DROP', '../1', '1%2F2', ' 1'])('recusa %j', (v) => expect(isEntityId(v)).toBe(false));

  it('rota com ID inválido vira null (não chama a api)', () => {
    expect(parseRouteId('12')).toBe('12');
    expect(parseRouteId('12abc')).toBeNull();
    expect(parseRouteId(undefined)).toBeNull();
    expect(parseRouteId(['7', '8'])).toBe('7');
  });

  it('apiPath codifica e valida', () => {
    expect(apiPath`/portal/employees/${'12'}/assignments/${'3'}`).toBe('/portal/employees/12/assignments/3');
    expect(() => apiPath`/portal/employees/${'1/../2'}`).toThrow(expect.objectContaining({ kind: 'not_found' }));
  });

  it('ID inválido nunca chega ao fetch: rejeita com not_found', async () => {
    const fetcher = vi.fn();
    const api = employeesApi(createApiClient(fetcher));
    await expect(api.get('../admin')).rejects.toMatchObject({ kind: 'not_found', status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('normaliza IDs numéricos da resposta para string, em qualquer profundidade', () => {
    const out = normalizeIds<Record<string, unknown>>({
      data: [{ id: 7, employeeId: 9, managerId: null, minutes: 30, punches: [{ adjustmentId: 3, nsr: 12 }] }],
      establishmentScope: [1, 2],
      meta: { page: 1, total: 2 },
    });
    expect(out).toEqual({
      data: [{ id: '7', employeeId: '9', managerId: null, minutes: 30, punches: [{ adjustmentId: '3', nsr: 12 }] }],
      establishmentScope: ['1', '2'],
      meta: { page: 1, total: 2 },
    });
  });

  it('o cliente aplica a normalização na resposta', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { id: 5, name: 'X', establishmentId: 1 } }), { status: 200 }));
    const api = employeesApi(createApiClient(fetcher));
    await expect(api.get('5')).resolves.toMatchObject({ id: '5', establishmentId: '1' });
  });
});
