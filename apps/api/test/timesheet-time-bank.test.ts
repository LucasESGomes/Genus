/**
 * Integração das duas metades: a batida no arp passa pelo consumidor da fila, vira
 * apuração e lança no banco de horas, contra Postgres reais do RH e do arp.
 */
import type { QueueJob } from '@genus/queue';
import { createLogger } from '@genus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgArpPunchReader } from '../src/arp/punch-reader';
import { TimeBankPoster } from '../src/modules/time-bank/poster';
import { createDayRecalculationProcessor } from '../src/modules/timesheets/consumer';
import { FixedClock, PortalHarness, type Org } from './support/portal';

/** Quinta-feira, 26/11/2026, 12:00 em São Paulo. */
const clock = new FixedClock('2026-11-26T15:00:00Z');
const h = new PortalHarness({ arp: true, clock });
const logger = createLogger({ level: 'error', service: 'timesheet-time-bank-test', destination: { write: () => undefined } });

let org: Org;
let rh: string;
let nsr = 0;

beforeAll(async () => {
  await h.start();
  await h.seedLegalParameters();
  // O banco de horas precisa dos prazos, que a fixture de apuração não traz.
  await h.client.query(
    `INSERT INTO rh.parametros_legais (chave, valor, vigencia_inicio) VALUES
       ('banco_prazo_meses_individual', '6', '2000-01-01'), ('banco_prazo_meses_coletivo', '12', '2000-01-01')`,
  );
  org = await h.createOrg();
  rh = (await h.loginAs(org, 'rh')).cookie;
}, 240_000);

afterAll(async () => {
  await h.stop();
});

const run = (name: string, data: unknown = {}) =>
  createDayRecalculationProcessor({
    db: h.handle.db,
    clock,
    arp: new PgArpPunchReader(h.arpReaderPool()),
    logger,
    posting: new TimeBankPoster({ clock }),
  })({ id: 'teste', name, data, attemptsMade: 0, opts: { attempts: 5 } } as unknown as QueueJob<unknown>);

async function employeeWithSchedule() {
  const emp = await h.createEmployee(org, { establishmentId: org.establishmentId });
  const s = await h.call(rh, 'POST', '/portal/schedules', {
    establishmentId: org.establishmentId,
    name: `Comercial ${emp.id}`,
    type: '5x2',
    cycleType: 'semanal',
    weeklyMinutes: 2400,
    days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
  });
  expect(s.statusCode).toBe(201);
  const a = await h.call(rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: s.json().data.id, validFrom: '2026-10-01' });
  expect(a.statusCode).toBe(201);
  return emp;
}

async function punch(cpf: string, date: string, time: string) {
  nsr += 1;
  await h.insertArpPunch({ tenantId: org.tenantId, establishmentId: org.establishmentId, nsr, cpf, at: new Date(`${date}T${time}:00-03:00`).toISOString() });
  return { outboxId: nsr, tenantId: org.tenantId, establishmentId: org.establishmentId, nsr };
}

const bankOf = async (employeeId: number) => {
  const res = await h.call(rh, 'GET', `/portal/employees/${employeeId}/time-bank`);
  expect(res.statusCode).toBe(200);
  return res.json().data as { balanceMinutes: number; entries: { date: string; type: string; minutes: number }[] };
};

describe('batida → apuração → banco de horas', () => {
  it('lança a extra do dia encerrado uma única vez e não debita a falta', async () => {
    const policy = await h.call(rh, 'PUT', `/portal/establishments/${org.establishmentId}/time-bank-policy`, {
      modality: 'individual_6m',
      sundayWeight: '1.00',
      holidayWeight: '1.00',
      validFrom: '2026-01-01',
    });
    expect(policy.statusCode).toBe(200);
    const emp = await employeeWithSchedule();

    // Terça 24/11: uma hora além do previsto (07:00-16:00 com 1 h de intervalo).
    let job = null;
    for (const t of ['07:00', '11:00', '12:00', '17:00']) job = await punch(emp.cpf, '2026-11-24', t);
    await run('recalculate-day', job);
    await run('recalculate-day', job);

    const first = await bankOf(emp.id);
    expect(first.entries.filter((e) => e.date === '2026-11-24')).toMatchObject([{ type: 'credito', minutes: 60 }]);
    // 23/11 (vizinho, sem batida) é falta: não debita o banco.
    expect(first.balanceMinutes).toBe(60);

    await run('close-days');
    expect((await bankOf(emp.id)).balanceMinutes).toBe(60);

    const day = await h.call(rh, 'GET', `/portal/timesheets?date=2026-11-24&establishmentId=${org.establishmentId}`);
    expect(day.statusCode).toBe(200);
    expect(day.json().data).toMatchObject([{ employeeId: emp.id, overtimeMinutes: 60, status: 'calculada' }]);
  });

  it('dia aberto não lança no banco', async () => {
    const emp = await employeeWithSchedule();
    let job = null;
    for (const t of ['05:00', '11:00']) job = await punch(emp.cpf, '2026-11-26', t);
    await run('recalculate-day', job);
    expect((await bankOf(emp.id)).entries.filter((e) => e.date === '2026-11-26')).toEqual([]);
  });
});
