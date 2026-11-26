/**
 * Banco de horas (G8) contra Postgres real: o lançamento da apuração
 * (`TimeBankPoster`, chamado direto, como a apuração chama dentro da transação
 * dela) e as rotas de saldo, extrato e regra. Os parâmetros legais são os da
 * migration 0019.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dailyTimesheets } from '../src/db/schema';
import { findEmployeeByCpf, type EmployeeRecord } from '../src/modules/employees/lookup';
import { loadLegalParameters } from '../src/modules/legal-parameters/repository';
import { TimeBankPoster } from '../src/modules/time-bank/poster';
import { computeDay, type DayInput, type DayResult } from '../src/modules/timesheets/rules/day';
import { BASE_URL, FixedClock, PortalHarness, type Org } from './support/portal';

const clock = new FixedClock('2026-11-25T12:00:00Z');
const h = new PortalHarness({ clock });
const poster = new TimeBankPoster({ clock });
let org: Org;
let rh: string;

beforeAll(async () => {
  await h.start();
  org = await h.createOrg();
  rh = (await h.loginAs(org, 'rh')).cookie;
});
afterAll(() => h.stop());

type Employee = EmployeeRecord;

async function employee(o: Org = org, opts: { establishmentId?: number; managerId?: number } = {}): Promise<Employee> {
  const { cpf } = await h.createEmployee(o, opts);
  return (await findEmployeeByCpf(h.handle.db, o.tenantId, cpf))!;
}

async function policy(
  emp: Employee,
  opts: { scope?: 'establishment' | 'employee'; modality?: string; sunday?: string; holiday?: string; validFrom?: string } = {},
): Promise<void> {
  const own = opts.scope === 'employee';
  await h.client.query(
    `INSERT INTO rh.regras_banco_horas (conta_id, estabelecimento_id, colaborador_id, modalidade, peso_domingo, peso_feriado, vigencia_inicio)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      emp.tenantId,
      own ? null : emp.establishmentId,
      own ? emp.id : null,
      opts.modality ?? 'individual_6m',
      opts.sunday ?? '1.00',
      opts.holiday ?? '1.00',
      opts.validFrom ?? '2026-01-01',
    ],
  );
}

/** Dia 08:00-17:00 com 1 h de intervalo (480 min), calculado pela regra real. */
async function result(emp: Employee, date: string, times: string[], over: Partial<DayInput> = {}): Promise<DayResult> {
  return computeDay({
    workDate: date,
    companyId: String(emp.companyId),
    schedule: { kind: 'trabalho', expectedPunches: ['08:00', '12:00', '13:00', '17:00'].map((t) => `${date}T${t}`) },
    holiday: null,
    leave: null,
    compensatoryRestGranted: false,
    punches: times.map((t, i) => ({ at: `${date}T${t}`, origin: 'original' as const, nsr: i + 1 })),
    previousShiftEnd: null,
    nightWorkType: 'urbano',
    parameters: await loadLegalParameters(h.handle.db, emp.tenantId, emp.companyId),
    ...over,
  });
}

/** Grava (ou reaproveita) a linha do dia e chama o hook na mesma transação, como a apuração. */
async function post(emp: Employee, day: DayResult, isClosed = true): Promise<void> {
  await h.handle.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dailyTimesheets)
      .values({ tenantId: emp.tenantId, employeeId: emp.id, date: day.workDate, situation: day.situation, parameterVersion: day.parameterVersion })
      .onConflictDoUpdate({ target: [dailyTimesheets.employeeId, dailyTimesheets.date], set: { situation: day.situation } })
      .returning({ id: dailyTimesheets.id });
    await poster.apply(tx, emp, { dailyTimesheetId: row!.id, date: day.workDate, result: day, isClosed });
  });
}

interface Entry {
  tipo: string;
  minutos: number;
  data_competencia: string;
  data_vencimento: string | null;
  criado_por: string | null;
}

async function entries(emp: Employee): Promise<Entry[]> {
  const res = await h.client.query(
    `SELECT tipo, minutos, data_competencia::text, data_vencimento::text, criado_por
       FROM rh.lancamentos_banco_horas WHERE conta_id = $1 AND colaborador_id = $2 ORDER BY id`,
    [emp.tenantId, emp.id],
  );
  return res.rows as Entry[];
}

const sum = (list: Entry[]) => list.reduce((s, e) => s + e.minutos, 0);
const ONE_HOUR_EXTRA = ['08:00', '12:00', '13:00', '18:00'];

async function manualEntry(emp: Employee, type: string, minutes: number, date: string, dueDate: string | null = null): Promise<void> {
  await h.client.query(
    'INSERT INTO rh.lancamentos_banco_horas (conta_id, colaborador_id, tipo, minutos, data_competencia, data_vencimento) VALUES ($1, $2, $3, $4, $5, $6)',
    [emp.tenantId, emp.id, type, minutes, date, dueDate],
  );
}

describe('lançamento automático (TimeBankPoster)', () => {
  it('sem regra na data não lança; regra que começa depois também não', async () => {
    const o = await h.createOrg();
    const emp = await employee(o);
    await post(emp, await result(emp, '2026-11-18', ONE_HOUR_EXTRA));
    await policy(emp, { validFrom: '2026-11-19' });
    await post(emp, await result(emp, '2026-11-18', ONE_HOUR_EXTRA));
    expect(await entries(emp)).toEqual([]);
  });

  it('dia aberto não lança; encerrado grava crédito do sistema com vencimento; repetir não duplica', async () => {
    const o = await h.createOrg();
    const emp = await employee(o);
    await policy(emp);
    const day = await result(emp, '2026-11-18', ONE_HOUR_EXTRA);
    await post(emp, day, false);
    expect(await entries(emp)).toEqual([]);
    await post(emp, day);
    await post(emp, day);
    expect(await entries(emp)).toEqual([
      { tipo: 'credito', minutos: 60, data_competencia: '2026-11-18', data_vencimento: '2027-05-18', criado_por: null },
    ]);
  });

  it('mudança do dia grava só a diferença; inconsistente estorna; outro dia fica como estava', async () => {
    const o = await h.createOrg();
    const emp = await employee(o);
    await policy(emp, { modality: 'coletivo_12m' });
    await post(emp, await result(emp, '2026-11-17', ONE_HOUR_EXTRA));
    await post(emp, await result(emp, '2026-11-18', ONE_HOUR_EXTRA));
    await post(emp, await result(emp, '2026-11-18', ['08:00', '12:00', '13:00', '18:30']));
    await post(emp, await result(emp, '2026-11-18', ['08:00', '12:00', '13:00', '16:30'])); // saiu 30 min antes
    expect((await entries(emp)).map((e) => [e.data_competencia, e.tipo, e.minutos, e.data_vencimento])).toEqual([
      ['2026-11-17', 'credito', 60, '2027-11-17'],
      ['2026-11-18', 'credito', 60, '2027-11-18'],
      ['2026-11-18', 'credito', 30, '2027-11-18'],
      ['2026-11-18', 'debito', -120, null],
    ]);
    expect(sum(await entries(emp))).toBe(30);

    await post(emp, await result(emp, '2026-11-18', ['08:00', '12:00', '13:00'])); // ímpar
    const after = await entries(emp);
    expect(after.at(-1)).toMatchObject({ tipo: 'credito', minutos: 30 });
    expect(sum(after)).toBe(60);
    // o estorno do dia 18 não consome o crédito do dia 17
    const res = await h.call((await h.loginAs(o, 'rh')).cookie, 'GET', `/portal/time-bank?establishmentId=${o.establishmentId}`);
    expect(res.json().data[0]).toMatchObject({ balanceMinutes: 60, nextDueDate: '2027-11-17' });
  });

  it('falta integral não debita', async () => {
    const o = await h.createOrg();
    const emp = await employee(o);
    await policy(emp);
    const day = await result(emp, '2026-11-18', []);
    expect(day.situation).toBe('falta');
    await post(emp, day);
    expect(await entries(emp)).toEqual([]);
  });

  it('a regra do colaborador vence a do estabelecimento; domingo com peso; feriado pagar_100 fica fora', async () => {
    const o = await h.createOrg();
    const emp = await employee(o);
    await policy(emp, { sunday: '1.20' });
    await policy(emp, { scope: 'employee', sunday: '2.00', holiday: '1.50' });
    const rest: Partial<DayInput> = { schedule: { kind: 'folga' } };
    await post(emp, await result(emp, '2026-11-22', ['08:00', '10:00'], rest)); // domingo
    await post(emp, await result(emp, '2026-11-20', ['08:00', '10:00'], { holiday: { worksOnHoliday: true, treatment: 'banco_horas' } }));
    await post(emp, await result(emp, '2026-11-02', ['08:00', '10:00'], { holiday: { worksOnHoliday: true, treatment: 'pagar_100' } }));
    expect((await entries(emp)).map((e) => [e.data_competencia, e.minutos])).toEqual([
      ['2026-11-22', 240],
      ['2026-11-20', 180],
    ]);
  });
});

describe('saldos e extrato', () => {
  it('lista com setor, saldo, a vencer e próximo vencimento pelo FIFO; busca e paginação', async () => {
    const o = await h.createOrg();
    const cookie = (await h.loginAs(o, 'rh')).cookie;
    const emp = await employee(o);
    await h.createAssignment(o, emp.id);
    const other = await employee(o);
    await h.client.query("UPDATE rh.colaboradores SET nome = 'Zélia Fictícia' WHERE id = $1", [other.id]);
    await employee(o, { establishmentId: o.otherEstablishmentId });

    await manualEntry(emp, 'credito', 120, '2026-06-10', '2026-12-10');
    await manualEntry(emp, 'credito', 60, '2026-07-01', '2027-01-01');
    await manualEntry(emp, 'debito', -90, '2026-08-01');

    const res = await h.call(cookie, 'GET', `/portal/time-bank?establishmentId=${o.establishmentId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [
        { employeeId: emp.id, employeeName: 'Pessoa Fictícia', departmentName: 'Colheita', balanceMinutes: 90, expiringIn30DaysMinutes: 30, nextDueDate: '2026-12-10' },
        { employeeId: other.id, employeeName: 'Zélia Fictícia', departmentName: null, balanceMinutes: 0, expiringIn30DaysMinutes: 0, nextDueDate: null },
      ],
      meta: { page: 1, pageSize: 25, total: 2 },
    });

    const search = await h.call(cookie, 'GET', `/portal/time-bank?establishmentId=${o.establishmentId}&q=zelia&pageSize=1`);
    expect(search.json().data.map((r: { employeeId: number }) => r.employeeId)).toEqual([other.id]);
    expect(search.json().meta).toEqual({ page: 1, pageSize: 1, total: 1 });
  });

  it('RH e o próprio colaborador veem o mesmo extrato', async () => {
    const emp = await employee();
    await manualEntry(emp, 'credito', 120, '2026-06-10', '2026-12-10');
    await manualEntry(emp, 'folga_compensatoria', -60, '2026-08-01');
    const expected = {
      data: {
        balanceMinutes: 60,
        expiringIn30DaysMinutes: 60,
        entries: [
          { date: '2026-06-10', type: 'credito', minutes: 120, dueDate: '2026-12-10' },
          { date: '2026-08-01', type: 'folga_compensatoria', minutes: -60, dueDate: null },
        ],
      },
    };
    const byRh = await h.call(rh, 'GET', `/portal/employees/${emp.id}/time-bank`);
    expect(byRh.statusCode).toBe(200);
    expect(byRh.json()).toEqual(expected);

    const self = (await h.loginAs(org, 'colaborador', { employeeId: emp.id })).cookie;
    expect((await h.call(self, 'GET', '/portal/me/time-bank')).json()).toEqual(expected);
    expect((await h.call(self, 'GET', `/portal/employees/${emp.id}/time-bank`)).statusCode).toBe(403);
    expect((await h.call(self, 'GET', `/portal/time-bank?establishmentId=${org.establishmentId}`)).statusCode).toBe(403);
  });

  it('outra conta e estabelecimento fora do escopo: 404', async () => {
    const emp = await employee();
    const outsider = await h.createOrg();
    const outsiderRh = (await h.loginAs(outsider, 'rh')).cookie;
    expect((await h.call(outsiderRh, 'GET', `/portal/employees/${emp.id}/time-bank`)).statusCode).toBe(404);
    expect((await h.call(outsiderRh, 'GET', `/portal/time-bank?establishmentId=${org.establishmentId}`)).statusCode).toBe(404);

    const scoped = (await h.loginAs(org, 'rh', { establishments: [org.otherEstablishmentId] })).cookie;
    expect((await h.call(scoped, 'GET', `/portal/time-bank?establishmentId=${org.establishmentId}`)).statusCode).toBe(404);
    expect((await h.call(scoped, 'GET', `/portal/employees/${emp.id}/time-bank`)).statusCode).toBe(404);
    expect((await h.call(scoped, 'GET', `/portal/establishments/${org.establishmentId}/time-bank-policy`)).statusCode).toBe(404);
  });

  it('gestor: desligado, 403; ligado, vê só a equipe e não vê a regra', async () => {
    const o = await h.createOrg();
    const boss = await employee(o);
    const member = await employee(o, { managerId: boss.id });
    const stranger = await employee(o);
    const gestor = (await h.loginAs(o, 'gestor', { employeeId: boss.id })).cookie;
    expect((await h.call(gestor, 'GET', `/portal/time-bank?establishmentId=${o.establishmentId}`)).statusCode).toBe(403);

    const app = await h.newApp({ gestorEnabled: true });
    try {
      const list = await h.call(gestor, 'GET', `/portal/time-bank?establishmentId=${o.establishmentId}`, undefined, app);
      expect(list.json().data.map((r: { employeeId: number }) => r.employeeId)).toEqual([member.id]);
      expect((await h.call(gestor, 'GET', `/portal/employees/${member.id}/time-bank`, undefined, app)).statusCode).toBe(200);
      expect((await h.call(gestor, 'GET', `/portal/employees/${stranger.id}/time-bank`, undefined, app)).statusCode).toBe(404);
      expect((await h.call(gestor, 'GET', `/portal/establishments/${o.establishmentId}/time-bank-policy`, undefined, app)).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

describe('regra do banco do estabelecimento', () => {
  const body = { modality: 'individual_6m', sundayWeight: '1.50', holidayWeight: '2.00', validFrom: '2026-06-01' };
  const url = (establishmentId: number) => `/portal/establishments/${establishmentId}/time-bank-policy`;
  const put = (cookie: string, establishmentId: number, payload: object) =>
    h.app.inject({ method: 'PUT', url: url(establishmentId), headers: { cookie, origin: BASE_URL }, payload });

  it('cria, atualiza no mesmo início, encerra a anterior e recusa início anterior, com auditoria', async () => {
    const o = await h.createOrg();
    const { cookie, userId } = await h.loginAs(o, 'rh');
    expect((await h.call(cookie, 'GET', url(o.establishmentId))).json()).toEqual({ data: null });

    const created = await put(cookie, o.establishmentId, body);
    expect(created.statusCode).toBe(200);
    expect(created.json().data).toEqual({ id: expect.any(Number), establishmentId: o.establishmentId, ...body, validTo: null });
    const id = created.json().data.id;

    const updated = await put(cookie, o.establishmentId, { ...body, sundayWeight: '1.75' });
    expect(updated.json().data).toMatchObject({ id, sundayWeight: '1.75', validTo: null });

    const next = await put(cookie, o.establishmentId, { ...body, modality: 'coletivo_12m', validFrom: '2027-01-01' });
    expect(next.json().data).toMatchObject({ modality: 'coletivo_12m', validFrom: '2027-01-01', validTo: null });
    // hoje ainda vale a primeira, agora encerrada na véspera
    expect((await h.call(cookie, 'GET', url(o.establishmentId))).json().data).toMatchObject({ id, validTo: '2026-12-31' });

    const before = await put(cookie, o.establishmentId, { ...body, validFrom: '2026-05-01' });
    expect(before.statusCode).toBe(409);
    expect(before.json().code).toBe('BANCO_REGRA_VIGENCIA');

    const audit = await h.client.query(
      "SELECT acao, usuario_id FROM rh.auditorias WHERE conta_id = $1 AND entidade = 'regras_banco_horas' ORDER BY id",
      [o.tenantId],
    );
    expect(audit.rows.map((r) => r.acao)).toEqual(['criacao', 'alteracao', 'alteracao', 'criacao']);
    expect(audit.rows.every((r) => Number(r.usuario_id) === userId)).toBe(true);
  });

  it('admin consulta e não escreve; outra conta recebe 404 e nada muda', async () => {
    const o = await h.createOrg();
    const admin = (await h.loginAs(o, 'admin')).cookie;
    expect((await h.call(admin, 'GET', url(o.establishmentId))).statusCode).toBe(200);
    expect((await put(admin, o.establishmentId, body)).statusCode).toBe(403);

    expect((await h.call(rh, 'GET', url(o.establishmentId))).statusCode).toBe(404);
    expect((await put(rh, o.establishmentId, body)).statusCode).toBe(404);
    const n = await h.one<{ n: string }>('SELECT count(*) AS n FROM rh.regras_banco_horas WHERE conta_id = $1', [o.tenantId]);
    expect(Number(n.n)).toBe(0);
  });

  it.each(['0.50', '10.00', '1.5', '1,50'])('peso %s: 400', async (sundayWeight) => {
    expect((await put(rh, org.establishmentId, { ...body, sundayWeight })).statusCode).toBe(400);
  });
});
