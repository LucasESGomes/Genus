/**
 * Visão geral (G11): empresa nova (zeros e listas vazias), dados semeados (KPIs, série,
 * situação, top extras, alertas), escopo do gestor, outra conta (404) e papel errado (403).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const clock = new FixedClock('2026-11-23T15:00:00Z');
const h = new PortalHarness({ arp: true, clock, gestorEnabled: true });
let org: Org;
let rh: string;
let scheduleId: number;
let nsr = 0;

const local = (date: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh + 3, mm)).toISOString();
};
async function punches(cpf: string, date: string, times: string[]) {
  for (const t of times) {
    nsr += 1;
    await h.insertArpPunch({ tenantId: org.tenantId, establishmentId: org.establishmentId, nsr, cpf, at: local(date, t) });
  }
}
type Kpi = { key: string; value: string; delta: string; tone: string };
const overview = async (cookie: string, from = '2026-11-16', to = '2026-11-20') =>
  h.call(cookie, 'GET', `/portal/overview?establishmentId=${org.establishmentId}&from=${from}&to=${to}`);
const kpi = (data: { kpis: Kpi[] }, key: string) => data.kpis.find((k) => k.key === key)!;

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
  org = await h.createOrg();
  rh = (await h.loginAs(org, 'rh')).cookie;
  const s = await h.call(rh, 'POST', '/portal/schedules', {
    establishmentId: org.establishmentId,
    name: 'Comercial',
    type: '5x2',
    cycleType: 'semanal',
    weeklyMinutes: 2400,
    days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
  });
  scheduleId = s.json().data.id;
}, 240_000);
afterAll(() => h.stop());

describe('GET /portal/overview', () => {
  it('empresa nova: zeros, série com todos os dias e listas vazias', async () => {
    const res = await overview(rh);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d.calculatedDays).toBe(0);
    expect(d.activeEmployees).toBe(0);
    expect(d.series).toHaveLength(5);
    expect(d.series.every((p: { workedMinutes: number }) => p.workedMinutes === 0)).toBe(true);
    expect(d.topOvertime).toEqual([]);
    expect(d.alerts).toEqual([]);
    expect(d.previousPeriod).toEqual({ from: '2026-11-11', to: '2026-11-15' });
    expect(kpi(d, 'workedHours').value).toBe('0');
  });

  it('com dados: soma horas, extras e faltas; alerta de sem escala e de inconsistência', async () => {
    const manager = await h.createEmployee(org);
    const ana = await h.createEmployee(org, { managerId: manager.id });
    const bruno = await h.createEmployee(org);
    await h.createEmployee(org); // sem escala
    for (const e of [manager, ana, bruno]) await h.call(rh, 'POST', `/portal/employees/${e.id}/schedules`, { scheduleId, validFrom: '2026-11-01' });

    // Ana: 16 a 20 completos, com 1 h extra no dia 18; Bruno: 16 e 17 completos, 18 ímpar, 19 e 20 sem batida (faltas)
    for (const date of ['2026-11-16', '2026-11-17', '2026-11-19', '2026-11-20']) await punches(ana.cpf, date, ['07:00', '11:00', '12:00', '16:00']);
    await punches(ana.cpf, '2026-11-18', ['07:00', '11:00', '12:00', '17:00']);
    for (const date of ['2026-11-16', '2026-11-17']) await punches(bruno.cpf, date, ['07:00', '11:00', '12:00', '16:00']);
    await punches(bruno.cpf, '2026-11-18', ['07:00', '11:00', '12:00']);
    for (const e of [manager, ana, bruno]) await h.call(rh, 'POST', `/portal/employees/${e.id}/timesheets/recalculate`, { from: '2026-11-16', to: '2026-11-20' });
    await h.call(rh, 'POST', `/portal/employees/${ana.id}/adjustments`, { date: '2026-11-19', type: 'justificativa', reason: 'Consulta médica' });

    const d = (await overview(rh)).json().data;
    expect(d.activeEmployees).toBe(4);
    expect(d.calculatedDays).toBe(15);
    expect(d.statusBreakdown.inconsistente).toBeGreaterThanOrEqual(1);
    expect(d.statusBreakdown.falta).toBeGreaterThanOrEqual(2);
    expect(d.series.find((p: { date: string }) => p.date === '2026-11-18').overtimeMinutes).toBe(60);
    expect(kpi(d, 'overtimeHours').value).toBe('1');
    expect(kpi(d, 'overtimeHours').tone).toBe('warn');
    expect(kpi(d, 'pendingAdjustments').value).toBe('1');
    expect(d.topOvertime).toEqual([{ employeeId: ana.id, name: expect.any(String), overtimeMinutes: 60 }]);
    const targets = d.alerts.map((a: { target: string }) => a.target);
    expect(targets).toEqual(expect.arrayContaining(['apuracao', 'colaboradores', 'ajustes']));

    // gestor vê só a equipe (Ana)
    const gestor = await h.loginAs(org, 'gestor', { employeeId: manager.id });
    const g = (await overview(gestor.cookie)).json().data;
    expect(g.activeEmployees).toBe(1);
    expect(g.calculatedDays).toBe(5);
    expect(g.alerts.map((a: { target: string }) => a.target)).not.toContain('colaboradores');
  });

  it('sem período usa os últimos 30 dias até hoje; período inválido = 400', async () => {
    const d = (await h.call(rh, 'GET', `/portal/overview?establishmentId=${org.establishmentId}`)).json().data;
    expect(d.period).toEqual({ from: '2026-10-25', to: '2026-11-23' });
    expect((await overview(rh, '2026-11-20', '2026-11-10')).statusCode).toBe(400);
    expect((await overview(rh, '2026-01-01', '2026-12-31')).statusCode).toBe(400);
  });

  it('outra conta = 404; contador e colaborador = 403', async () => {
    const other = await h.createOrg();
    const intruder = await h.loginAs(other, 'rh');
    expect((await overview(intruder.cookie)).statusCode).toBe(404);
    expect((await overview((await h.loginAs(org, 'contador')).cookie)).statusCode).toBe(403);
    const emp = await h.createEmployee(org);
    expect((await overview((await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie)).statusCode).toBe(403);
  });
});
