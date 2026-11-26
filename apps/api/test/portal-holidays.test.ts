/**
 * Feriados (G3, RF14 a RF16): carga nacional da migration 0021, feriado da conta, regra do
 * estabelecimento e o reflexo na apuração (recalcula os dias já apurados).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nationalHolidays } from '../src/modules/holidays/rules/national';
import { FixedClock, PortalHarness, type Org } from './support/portal';

const clock = new FixedClock('2026-11-23T12:00:00Z');
const h = new PortalHarness({ arp: true, clock, keepNationalHolidays: true });
let org: Org;
let rh: string;
let scheduleId: number;
let nsr = 0;

const local = (date: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), hh + 3, mm)).toISOString();
};
async function workDay(cpf: string, date: string) {
  for (const t of ['07:00', '11:00', '12:00', '16:00']) {
    nsr += 1;
    await h.insertArpPunch({ tenantId: org.tenantId, establishmentId: org.establishmentId, nsr, cpf, at: local(date, t) });
  }
}
const day = async (empId: number, date: string) =>
  (await h.call(rh, 'GET', `/portal/employees/${empId}/timesheets?from=${date}&to=${date}`)).json().data[0] as {
    situation: string;
    expectedMinutes: number;
    overtime100Minutes: number;
  };

async function employeeWorking(date: string) {
  const emp = await h.createEmployee(org);
  await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId, validFrom: '2026-01-01' });
  await workDay(emp.cpf, date);
  await h.call(rh, 'POST', `/portal/employees/${emp.id}/timesheets/recalculate`, { from: date, to: date });
  return emp;
}

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

describe('carga nacional (migration 0021)', () => {
  it('tem os feriados de 2026 a 2030 iguais à regra pura', async () => {
    const rows = (await h.client.query("SELECT to_char(data, 'YYYY-MM-DD') AS date, nome AS name, facultativo AS \"isOptional\" FROM rh.feriados WHERE conta_id IS NULL ORDER BY data")).rows;
    const expected = [2026, 2027, 2028, 2029, 2030].flatMap((y) => nationalHolidays(y));
    expect(rows).toEqual(expected);
  });

  it('GET /holidays lista os 13 do ano no estabelecimento', async () => {
    const res = await h.call(rh, 'GET', `/portal/holidays?establishmentId=${org.establishmentId}&year=2026`);
    expect(res.statusCode).toBe(200);
    const list = res.json().data as { date: string; isOptional: boolean; isOwn: boolean }[];
    expect(list).toHaveLength(13);
    expect(list.filter((x) => !x.isOptional)).toHaveLength(9);
    expect(list.every((x) => !x.isOwn)).toBe(true);
    expect(list.map((x) => x.date)).toContain('2026-11-20');
  });
});

describe('apuração no feriado', () => {
  it('20/11/2026 (sexta) é feriado: nada previsto e o trabalhado vira extra a 100%', async () => {
    const emp = await employeeWorking('2026-11-20');
    const d = await day(emp.id, '2026-11-20');
    expect(d.situation).toBe('feriado');
    expect(d.expectedMinutes).toBe(0);
    expect(d.overtime100Minutes).toBeGreaterThan(0);
  });

  it('feriado da conta (municipal) recalcula o dia já apurado; remover volta ao normal', async () => {
    const emp = await employeeWorking('2026-11-17');
    expect((await day(emp.id, '2026-11-17')).situation).toBe('normal');

    const created = await h.call(rh, 'POST', '/portal/holidays', { establishmentId: org.establishmentId, date: '2026-11-17', name: 'Aniversário da cidade', scope: 'municipal' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ scope: 'municipal', uf: 'SP', municipalityIbge: '3550308', isOwn: true });
    expect((await day(emp.id, '2026-11-17')).situation).toBe('feriado');

    const dup = await h.call(rh, 'POST', '/portal/holidays', { establishmentId: org.establishmentId, date: '2026-11-17', name: 'De novo', scope: 'municipal' });
    expect(dup.statusCode).toBe(409);

    const id = created.json().data.id;
    expect((await h.call(rh, 'PATCH', `/portal/holidays/${id}`, { name: 'Aniversário de São Paulo' })).json().data.name).toBe('Aniversário de São Paulo');
    expect((await h.call(rh, 'DELETE', `/portal/holidays/${id}`)).statusCode).toBe(204);
    expect((await day(emp.id, '2026-11-17')).situation).toBe('normal');
  });

  it('regra do estabelecimento: trabalha com banco de horas; facultativo não aceita "trabalha"', async () => {
    const list = (await h.call(rh, 'GET', `/portal/holidays?establishmentId=${org.establishmentId}&year=2026`)).json().data as { id: number; date: string; isOptional: boolean }[];
    const natal = list.find((x) => x.date === '2026-12-25')!;
    const res = await h.call(rh, 'PUT', `/portal/establishments/${org.establishmentId}/holidays/${natal.id}`, { isWorked: true, treatment: 'banco_horas' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ isWorked: true, treatment: 'banco_horas' });
    const again = (await h.call(rh, 'GET', `/portal/holidays?establishmentId=${org.establishmentId}&year=2026`)).json().data as { id: number; isWorked: boolean }[];
    expect(again.find((x) => x.id === natal.id)?.isWorked).toBe(true);
    // a filial não herda a regra da matriz
    const filial = (await h.call(rh, 'GET', `/portal/holidays?establishmentId=${org.otherEstablishmentId}&year=2026`)).json().data as { id: number; isWorked: boolean }[];
    expect(filial.find((x) => x.id === natal.id)?.isWorked).toBe(false);

    expect((await h.call(rh, 'PUT', `/portal/establishments/${org.establishmentId}/holidays/${natal.id}`, { isWorked: true })).statusCode).toBe(400);
    const carnaval = list.find((x) => x.isOptional)!;
    expect((await h.call(rh, 'PUT', `/portal/establishments/${org.establishmentId}/holidays/${carnaval.id}`, { isWorked: true, treatment: 'pagar_100' })).statusCode).toBe(400);
  });

  it('feriado oficial não se altera nem remove (404); outra conta não vê o da conta; contador = 403', async () => {
    const list = (await h.call(rh, 'GET', `/portal/holidays?establishmentId=${org.establishmentId}&year=2026`)).json().data as { id: number }[];
    expect((await h.call(rh, 'PATCH', `/portal/holidays/${list[0]!.id}`, { name: 'Outro nome' })).statusCode).toBe(404);
    expect((await h.call(rh, 'DELETE', `/portal/holidays/${list[0]!.id}`)).statusCode).toBe(404);

    const own = (await h.call(rh, 'POST', '/portal/holidays', { establishmentId: org.establishmentId, date: '2026-07-09', name: 'Data da conta', scope: 'nacional' })).json().data;
    const other = await h.createOrg();
    const intruder = await h.loginAs(other, 'rh');
    const theirs = (await h.call(intruder.cookie, 'GET', `/portal/holidays?establishmentId=${other.establishmentId}&year=2026`)).json().data as { id: number }[];
    expect(theirs.map((x) => x.id)).not.toContain(own.id);
    expect((await h.call(intruder.cookie, 'PATCH', `/portal/holidays/${own.id}`, { name: 'Invasão' })).statusCode).toBe(404);
    expect((await h.call(intruder.cookie, 'GET', `/portal/holidays?establishmentId=${org.establishmentId}&year=2026`)).statusCode).toBe(404);

    const contador = await h.loginAs(org, 'contador');
    expect((await h.call(contador.cookie, 'GET', `/portal/holidays?establishmentId=${org.establishmentId}&year=2026`)).statusCode).toBe(403);
  });
});
