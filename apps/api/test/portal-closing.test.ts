/**
 * Áreas 5 e 6: fechamento, reabertura, espelho, ciência, auditoria imutável e
 * as rotas /me do portal do colaborador, contra Postgres real do RH e do arp.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const h = new PortalHarness({ arp: true, clock: new FixedClock('2026-11-23T12:00:00Z') });
let nsr = 0;

const local = (date: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh + 3, mm)).toISOString();
};

interface Scenario {
  org: Org;
  rh: { userId: number; cookie: string };
  rh2: string;
  emp: { id: number; cpf: string };
}

/** Conta nova com escala 5x2 e um colaborador com 4 batidas em 05/10/2026 (segunda). */
async function scenario(punches = ['07:00', '11:00', '12:00', '16:00']): Promise<Scenario> {
  const org = await h.createOrg();
  const rh = await h.loginAs(org, 'rh');
  const rh2 = (await h.loginAs(org, 'rh')).cookie;
  const scheduleId = (
    await h.call(rh.cookie, 'POST', '/portal/schedules', {
      establishmentId: org.establishmentId,
      name: '5x2',
      type: '5x2',
      cycleType: 'semanal',
      weeklyMinutes: 2400,
      days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
    })
  ).json().data.id;
  const emp = await h.createEmployee(org);
  expect((await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId, validFrom: '2026-10-01' })).statusCode).toBe(201);
  for (const t of punches) {
    nsr += 1;
    await h.insertArpPunch({ tenantId: org.tenantId, establishmentId: org.establishmentId, nsr, cpf: emp.cpf, at: local('2026-10-05', t) });
  }
  expect((await h.call(rh.cookie, 'POST', `/portal/employees/${emp.id}/timesheets/recalculate`, { from: '2026-10-05', to: '2026-10-05' })).statusCode).toBe(200);
  return { org, rh, rh2, emp };
}

const openOctober = async (s: Scenario) => {
  const res = await h.call(s.rh.cookie, 'POST', '/portal/closings', { establishmentId: s.org.establishmentId, referenceMonth: '2026-10' });
  expect(res.statusCode).toBe(201);
  return res.json().data.id as number;
};

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
});
afterAll(() => h.stop());

describe('competência', () => {
  it('rh abre (1 a 31); duplicada → 409; mês inválido → 400; admin não abre; contador lista', async () => {
    const s = await scenario();
    const id = await openOctober(s);
    const dup = await h.call(s.rh.cookie, 'POST', '/portal/closings', { establishmentId: s.org.establishmentId, referenceMonth: '2026-10' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('FECHAMENTO_DUPLICADO');
    expect((await h.call(s.rh.cookie, 'POST', '/portal/closings', { establishmentId: s.org.establishmentId, referenceMonth: '2026-13' })).statusCode).toBe(400);
    const admin = (await h.loginAs(s.org, 'admin')).cookie;
    expect((await h.call(admin, 'POST', '/portal/closings', { establishmentId: s.org.establishmentId, referenceMonth: '2026-09' })).statusCode).toBe(403);
    const contador = (await h.loginAs(s.org, 'contador')).cookie;
    const list = (await h.call(contador, 'GET', '/portal/closings')).json().data;
    expect(list).toEqual([expect.objectContaining({ id, referenceMonth: '2026-10', startDate: '2026-10-01', endDate: '2026-10-31', status: 'aberto' })]);
    // estabelecimento de outra conta: 400, sem confirmar que existe
    const other = await h.createOrg();
    expect((await h.call(s.rh.cookie, 'POST', '/portal/closings', { establishmentId: other.establishmentId, referenceMonth: '2026-10' })).statusCode).toBe(400);
  });

  it('pendência trava o fechamento (409 FECHAMENTO_COM_PENDENCIAS); resolvida, fecha; depois, alteração → 409 PERIODO_FECHADO', async () => {
    const s = await scenario(['07:00', '11:00', '12:00']);
    const id = await openOctober(s);
    const blocked = await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/close`, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('FECHAMENTO_COM_PENDENCIAS');

    const adj = (
      await h.call(s.rh.cookie, 'POST', `/portal/employees/${s.emp.id}/adjustments`, {
        date: '2026-10-05',
        type: 'inclusao_batida',
        proposedAt: local('2026-10-05', '16:00'),
        reason: 'Esqueceu a saída',
      })
    ).json().data.id;
    // ajuste pendente também trava
    expect((await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/close`, {})).json().code).toBe('FECHAMENTO_COM_PENDENCIAS');
    expect((await h.call(s.rh2, 'POST', `/portal/adjustments/${adj}/approve`, {})).statusCode).toBe(200);

    const closed = await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/close`, {});
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.status).toBe('fechado');
    expect((await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/close`, {})).json().code).toBe('STATUS_INVALIDO');

    const recalc = await h.call(s.rh.cookie, 'POST', `/portal/employees/${s.emp.id}/timesheets/recalculate`, { from: '2026-10-05', to: '2026-10-05' });
    expect(recalc.statusCode).toBe(409);
    expect(recalc.json().code).toBe('PERIODO_FECHADO');
    const late = await h.call(s.rh.cookie, 'POST', `/portal/employees/${s.emp.id}/adjustments`, { date: '2026-10-06', type: 'justificativa', reason: 'Depois do fechamento' });
    expect(late.json().code).toBe('PERIODO_FECHADO');
  });
});

describe('espelho, ciência e reabertura', () => {
  it('emite após fechar; rh vê CPF completo, contador mascarado; colaborador dá ciência uma vez; reabrir apaga a ciência e audita', async () => {
    const s = await scenario();
    const id = await openOctober(s);
    expect((await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/mirrors`, {})).json().code).toBe('STATUS_INVALIDO');
    expect((await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/close`, {})).statusCode).toBe(200);
    const gen = await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/mirrors`, {});
    expect(gen.json().data).toEqual({ generated: 1, total: 1 });
    expect((await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/mirrors`, {})).json().data).toEqual({ generated: 0, total: 1 });

    const rhView = (await h.call(s.rh.cookie, 'GET', `/portal/closings/${id}/mirrors/${s.emp.id}`)).json().data;
    expect(rhView.employee.cpf).toBe(s.emp.cpf);
    expect(rhView.days).toHaveLength(1);
    expect(rhView.totals.workedMinutes).toBe(480);
    expect(rhView.pdfUrl).toBeNull();
    const contador = (await h.loginAs(s.org, 'contador')).cookie;
    const accView = await h.call(contador, 'GET', `/portal/closings/${id}/mirrors/${s.emp.id}`);
    expect(accView.statusCode).toBe(200);
    expect(accView.json().data.employee.cpf).not.toBe(s.emp.cpf);
    expect(accView.body).not.toContain(s.emp.cpf);

    const colab = (await h.loginAs(s.org, 'colaborador', { employeeId: s.emp.id })).cookie;
    expect((await h.call(colab, 'GET', '/portal/me/mirrors')).json().data).toEqual([{ closingId: id, referenceMonth: '2026-10', status: 'fechado', acknowledgedAt: null }]);
    expect((await h.call(colab, 'GET', `/portal/me/mirrors/${id}`)).json().data.totals.workedMinutes).toBe(480);
    const ack = await h.call(colab, 'POST', `/portal/me/mirrors/${id}/acknowledge`, {});
    expect(ack.statusCode).toBe(200);
    const row = await h.one<{ ciencia_ip: string }>('SELECT host(ciencia_ip) AS ciencia_ip FROM rh.espelhos WHERE fechamento_id = $1', [id]);
    expect(row.ciencia_ip).toBe('127.0.0.1');
    expect((await h.call(colab, 'POST', `/portal/me/mirrors/${id}/acknowledge`, {})).json().code).toBe('STATUS_INVALIDO');
    // colaborador não usa as rotas do RH
    expect((await h.call(colab, 'GET', `/portal/closings/${id}/mirrors/${s.emp.id}`)).statusCode).toBe(403);

    expect((await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/reopen`, {})).statusCode).toBe(400);
    const reopened = await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/reopen`, { reason: 'Ajuste de batida após conferência' });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().data).toMatchObject({ status: 'reaberto', reopenReason: 'Ajuste de batida após conferência' });
    expect((await h.call(colab, 'GET', '/portal/me/mirrors')).json().data[0].acknowledgedAt).toBeNull();
    expect((await h.call(colab, 'POST', `/portal/me/mirrors/${id}/acknowledge`, {})).json().code).toBe('STATUS_INVALIDO');
    const audit = await h.one<{ motivo: string }>("SELECT motivo FROM rh.auditorias WHERE entidade = 'fechamentos' AND entidade_id = $1 AND acao = 'reabertura'", [id]);
    expect(audit.motivo).toBe('Ajuste de batida após conferência');
    // reaberto: a apuração volta a aceitar recálculo
    expect((await h.call(s.rh.cookie, 'POST', `/portal/employees/${s.emp.id}/timesheets/recalculate`, { from: '2026-10-05', to: '2026-10-05' })).statusCode).toBe(200);
  });

  it('colaborador não vê o espelho de outro; rh de outra conta ou outro estabelecimento → 404', async () => {
    const s = await scenario();
    const id = await openOctober(s);
    await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/close`, {});
    await h.call(s.rh.cookie, 'POST', `/portal/closings/${id}/mirrors`, {});
    const stranger = await h.createEmployee(s.org);
    const colab = (await h.loginAs(s.org, 'colaborador', { employeeId: stranger.id })).cookie;
    expect((await h.call(colab, 'GET', `/portal/me/mirrors/${id}`)).statusCode).toBe(404);
    const foreign = (await h.loginAs(await h.createOrg(), 'rh')).cookie;
    expect((await h.call(foreign, 'GET', `/portal/closings/${id}/mirrors/${s.emp.id}`)).statusCode).toBe(404);
    expect((await h.call(foreign, 'POST', `/portal/closings/${id}/reopen`, { reason: 'Tentativa de fora' })).statusCode).toBe(404);
    const scoped = (await h.loginAs(s.org, 'rh', { establishments: [s.org.otherEstablishmentId] })).cookie;
    expect((await h.call(scoped, 'GET', `/portal/closings/${id}/mirrors/${s.emp.id}`)).statusCode).toBe(404);
    expect((await h.call(scoped, 'GET', '/portal/closings')).json().data).toEqual([]);
  });

  it('auditoria é imutável: UPDATE e DELETE falham no banco', async () => {
    const s = await scenario();
    await openOctober(s);
    const { id } = await h.one<{ id: string }>("SELECT id FROM rh.auditorias WHERE entidade = 'fechamentos' ORDER BY id DESC LIMIT 1");
    await expect(h.client.query("UPDATE rh.auditorias SET motivo = 'x' WHERE id = $1", [id])).rejects.toThrow();
    await expect(h.client.query('DELETE FROM rh.auditorias WHERE id = $1', [id])).rejects.toThrow();
  });
});

describe('portal do colaborador: apuração e banco de horas', () => {
  it('vê só a própria apuração e o próprio saldo; rh nas rotas /me → 403', async () => {
    const s = await scenario();
    const colab = (await h.loginAs(s.org, 'colaborador', { employeeId: s.emp.id })).cookie;
    const days = await h.call(colab, 'GET', '/portal/me/timesheets?from=2026-10-01&to=2026-10-31');
    expect(days.statusCode).toBe(200);
    expect(days.json().data.map((d: { date: string }) => d.date)).toEqual(['2026-10-05']);
    expect((await h.call(colab, 'GET', '/portal/me/timesheets?from=2026-10-31&to=2026-10-01')).statusCode).toBe(400);

    await h.client.query(
      `INSERT INTO rh.lancamentos_banco_horas (conta_id, colaborador_id, tipo, minutos, data_competencia, criado_por) VALUES ($1, $2, 'credito', 90, '2026-10-05', $3)`,
      [s.org.tenantId, s.emp.id, s.rh.userId],
    );
    const bank = (await h.call(colab, 'GET', '/portal/me/time-bank')).json().data;
    expect(bank.balanceMinutes).toBe(90);
    expect(bank.entries).toEqual([{ date: '2026-10-05', type: 'credito', minutes: 90, dueDate: null }]);

    const other = await h.createEmployee(s.org);
    const otherColab = (await h.loginAs(s.org, 'colaborador', { employeeId: other.id })).cookie;
    expect((await h.call(otherColab, 'GET', '/portal/me/time-bank')).json().data.balanceMinutes).toBe(0);
    expect((await h.call(otherColab, 'GET', '/portal/me/timesheets?from=2026-10-01&to=2026-10-31')).json().data).toEqual([]);
    expect((await h.call(s.rh.cookie, 'GET', '/portal/me/time-bank')).statusCode).toBe(403);
  });
});
