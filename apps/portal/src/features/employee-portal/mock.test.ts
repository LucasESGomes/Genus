import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { mockEmployeePortalApi as api, resetEmployeePortalMock } from '@/lib/api/mocks/employee-portal';

beforeEach(() => resetEmployeePortalMock());

const file = () => new File(['x'], 'a.png', { type: 'image/png' });
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('devia falhar');
};

describe('mock do portal do funcionário', () => {
  it('atestado: dias OU horas, com faixas da api (422 com details)', async () => {
    const both = await fails(api.submitCertificate({ file: file(), startDate: '2026-11-20', days: 1, hours: 2 }));
    expect(both.status).toBe(422);
    expect(both.fields.map((f) => f.path)).toContain('hours');
    const none = await fails(api.submitCertificate({ file: file(), startDate: '2026-11-20' }));
    expect(none.fields.map((f) => f.path)).toContain('days');
    expect((await fails(api.submitCertificate({ file: file(), startDate: '2026-11-20', days: 366 }))).fields[0]?.path).toBe('days');
    expect((await fails(api.submitCertificate({ file: file(), startDate: '2026-11-20', hours: 25 }))).fields[0]?.path).toBe('hours');
    await expect(api.submitCertificate({ file: file(), startDate: '2026-11-20', days: 365 })).resolves.toMatchObject({ status: 'pendente', days: 365, hours: null });
  });

  it('atestado enviado aparece na leitura seguinte, sem campos de análise', async () => {
    const before = await api.certificates();
    const created = await api.submitCertificate({ file: file(), startDate: '2026-11-21', hours: 3 });
    const after = await api.certificates();
    expect(after).toHaveLength(before.length + 1);
    expect(after[0]).toEqual(created);
    expect(Object.keys(created).sort()).toEqual(['days', 'decidedAt', 'decisionReason', 'employeeId', 'hours', 'id', 'sentAt', 'startDate', 'status']);
  });

  it('férias: 21 a 31/12 devolve 409 FERIAS_SETOR_DESFALCADO; outro intervalo cria "solicitada"', async () => {
    const e = await fails(api.requestVacation({ accrualPeriodId: '701', startDate: '2026-12-20', endDate: '2026-12-22' }));
    expect(e.status).toBe(409);
    expect(e.code).toBe('FERIAS_SETOR_DESFALCADO');
    const ok = await api.requestVacation({ accrualPeriodId: '701', startDate: '2027-01-11', endDate: '2027-01-15' });
    expect(ok).toMatchObject({ status: 'solicitada', days: 5 });
    expect((await api.vacations())[0]?.vacations.some((v) => v.id === ok.id)).toBe(true);
  });

  it('ciência: grava uma vez; a segunda é 409; id desconhecido é 404', async () => {
    const ack = await api.acknowledge('502');
    expect(ack.closingId).toBe('502');
    expect((await api.mirrors()).find((m) => m.closingId === '502')?.acknowledgedAt).toBe(ack.acknowledgedAt);
    expect((await fails(api.acknowledge('502'))).status).toBe(409);
    expect((await fails(api.acknowledge('999'))).status).toBe(404);
  });

  it('ajuste: inclusão exige horário; mês fechado é 409 PERIODO_FECHADO', async () => {
    expect((await fails(api.requestAdjustment({ date: '2026-11-20', type: 'inclusao_batida', reason: 'esqueci' }))).fields[0]?.path).toBe('proposedAt');
    expect((await fails(api.requestAdjustment({ date: '2026-10-05', type: 'justificativa', reason: 'consulta' }))).code).toBe('PERIODO_FECHADO');
    await expect(api.requestAdjustment({ date: '2026-11-20', type: 'justificativa', reason: 'consulta' })).resolves.toMatchObject({ status: 'pendente', employeeId: '101' });
  });

  it('apuração: só até hoje (21/11) e hoje tem 3 marcações', async () => {
    const days = await api.timesheets({ from: '2026-11-01', to: '2026-11-30' });
    expect(days.at(-1)?.date).toBe('2026-11-21');
    expect(days.at(-1)?.punches).toHaveLength(3);
  });
});
