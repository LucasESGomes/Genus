/**
 * Apuração automática (fila `day-recalculation`, dia aberto x encerrado,
 * `close-days`) e o dia do estabelecimento (GET /portal/timesheets e o
 * recálculo), contra Postgres do RH e do arp e um Valkey reais.
 */
import { createDayRecalculationQueue, createOutboxEventQueues, createProducerConnection, postPunchJobId, VALKEY_IMAGE, type QueueJob } from '@genus/queue';
import { createLogger } from '@genus/shared';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PgArpPunchReader } from '../src/arp/punch-reader';
import type { DayPostingHook, PostedDay } from '../src/modules/time-bank/posting-hook';
import type { AutoRecalculationDeps } from '../src/modules/timesheets/auto-recalculation';
import { createDayRecalculationProcessor, startDayRecalculation } from '../src/modules/timesheets/consumer';
import { findEmployeeByCpf } from '../src/modules/employees/lookup';
import { TimesheetService } from '../src/modules/timesheets/service';
import { fakeCpf, FixedClock, PortalHarness, type Org } from './support/portal';

/** Quinta-feira, 26/11/2026, 12:00 em São Paulo. */
const NOW = '2026-11-26T15:00:00Z';
const clock = new FixedClock(NOW);
const h = new PortalHarness({ arp: true, clock });
let valkey: StartedTestContainer;
let valkeyUrl: string;
let nsr = 0;

const logLines: string[] = [];
const logger = createLogger({ level: 'debug', service: 'timesheet-auto-test', destination: { write: (chunk: string) => void logLines.push(chunk) } });

const posted: (PostedDay & { employeeId: number })[] = [];
const posting: DayPostingHook = {
  apply: async (_tx, emp, day) => {
    posted.push({ ...day, employeeId: emp.id });
  },
};

// São Paulo (UTC-3, sem horário de verão)
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-03:00`).toISOString();

interface Team {
  org: Org;
  rh: string;
  rhUserId: number;
}

async function team(): Promise<Team> {
  const org = await h.createOrg();
  const rh = await h.loginAs(org, 'rh');
  return { org, rh: rh.cookie, rhUserId: rh.userId };
}

async function employee(t: Team, opts: { schedule?: boolean; name?: string; establishmentId?: number; admissionDate?: string; scheduleFrom?: string } = {}) {
  const establishmentId = opts.establishmentId ?? t.org.establishmentId;
  const emp = await h.createEmployee(t.org, { establishmentId, ...(opts.admissionDate ? { admissionDate: opts.admissionDate } : {}) });
  if (opts.name) await h.client.query('UPDATE rh.colaboradores SET nome = $2 WHERE id = $1', [emp.id, opts.name]);
  if (opts.schedule ?? true) {
    const s = await h.call(t.rh, 'POST', '/portal/schedules', {
      establishmentId,
      name: `Comercial ${emp.id}`,
      type: '5x2',
      cycleType: 'semanal',
      weeklyMinutes: 2400,
      days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '07:00', endTime: '16:00', breakStartTime: '11:00', breakEndTime: '12:00' })),
    });
    expect(s.statusCode).toBe(201);
    const res = await h.call(t.rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: s.json().data.id, validFrom: opts.scheduleFrom ?? '2026-10-01' });
    expect(res.statusCode).toBe(201);
  }
  return emp;
}

/** Grava as batidas no arp e devolve os NSRs. */
async function punches(t: Team, emp: { cpf: string }, date: string, times: string[]): Promise<number[]> {
  const out: number[] = [];
  for (const time of times) {
    nsr += 1;
    await h.insertArpPunch({ tenantId: t.org.tenantId, establishmentId: t.org.establishmentId, nsr, cpf: emp.cpf, at: local(date, time) });
    out.push(nsr);
  }
  return out;
}

const deps = (over: Partial<AutoRecalculationDeps> = {}): AutoRecalculationDeps => ({
  db: h.handle.db,
  clock,
  arp: new PgArpPunchReader(h.arpReaderPool()),
  logger,
  posting,
  ...over,
});

const job = (name: string, data: unknown = {}, attemptsMade = 0) => ({ id: 'teste', name, data, attemptsMade, opts: { attempts: 5 } }) as unknown as QueueJob<unknown>;
const punchJob = (t: Team, n: number) => job('recalculate-day', { outboxId: n, tenantId: t.org.tenantId, establishmentId: t.org.establishmentId, nsr: n });
const run = (j: QueueJob<unknown>, over: Partial<AutoRecalculationDeps> = {}) => createDayRecalculationProcessor(deps(over))(j);

interface DayRow {
  date: string;
  situation: string;
  worked: number;
  absence: number;
  late: number;
  issues: string[] | null;
  punches: number;
  calculatedAt: Date;
}

async function daysOf(employeeId: number): Promise<DayRow[]> {
  const res = await h.client.query(
    `SELECT to_char(d.data, 'YYYY-MM-DD') AS date, d.situacao AS situation, d.minutos_trabalhados AS worked,
            d.minutos_falta AS absence, d.minutos_atraso AS late, d.calculado_em AS "calculatedAt",
            (SELECT array_agg(i.tipo ORDER BY i.tipo) FROM rh.inconsistencias i WHERE i.apuracao_dia_id = d.id) AS issues,
            (SELECT count(*)::int FROM rh.apuracoes_marcacoes m WHERE m.apuracao_dia_id = d.id) AS punches
       FROM rh.apuracoes_dia d WHERE d.colaborador_id = $1 ORDER BY d.data`,
    [employeeId],
  );
  return res.rows as DayRow[];
}
const byDate = async (employeeId: number) => Object.fromEntries((await daysOf(employeeId)).map((d) => [d.date, d]));

async function closeMonth(t: Team, month: string, end: string) {
  await h.client.query(
    `INSERT INTO rh.fechamentos (conta_id, estabelecimento_id, competencia, data_inicio, data_fim, status, fechado_por, fechado_em)
     VALUES ($1, $2, $3, $3, $4, 'fechado', $5, now())`,
    [t.org.tenantId, t.org.establishmentId, month, end, t.rhUserId],
  );
}

async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!(await check())) {
    if (performance.now() - start > timeoutMs) throw new Error(`Prazo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  [valkey] = await Promise.all([
    new GenericContainer(VALKEY_IMAGE)
      .withExposedPorts(6379)
      .withCommand(['valkey-server', '--maxmemory-policy', 'noeviction'])
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
    h.start(),
  ]);
  valkeyUrl = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
  await h.seedLegalParameters();
});
afterAll(async () => {
  await h.stop();
  await valkey?.stop();
});
beforeEach(() => {
  clock.set(NOW);
  posted.length = 0;
});

describe('recalculate-day', () => {
  it('recalcula o dia anterior, o da batida e o seguinte (até hoje); repetir não duplica', async () => {
    const t = await team();
    const emp = await employee(t);
    const [first] = await punches(t, emp, '2026-11-24', ['07:00', '11:00', '12:00', '16:00']);

    await run(punchJob(t, first!));
    await run(punchJob(t, first!));

    const days = await daysOf(emp.id);
    expect(days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
    expect(days[0]).toMatchObject({ situation: 'falta', absence: 480 });
    expect(days[1]).toMatchObject({ situation: 'normal', worked: 480, punches: 4, issues: null });
    expect(posted.every((p) => p.isClosed && p.employeeId === emp.id)).toBe(true);
    expect(posted).toHaveLength(6);
    expect(new Set(posted.map((p) => p.dailyTimesheetId)).size).toBe(3);
  });

  it('batida de hoje: não calcula o futuro; dia aberto sem ímpar, falta nem atraso, e o banco recebe isClosed false', async () => {
    const t = await team();
    const emp = await employee(t);
    const [first] = await punches(t, emp, '2026-11-26', ['07:30', '11:00', '12:00']);

    await run(punchJob(t, first!));

    const days = await byDate(emp.id);
    expect(Object.keys(days)).toEqual(['2026-11-25', '2026-11-26']);
    expect(days['2026-11-26']).toMatchObject({ situation: 'normal', absence: 0, late: 0, issues: null, punches: 3 });
    const today = posted.find((p) => p.date === '2026-11-26')!;
    expect(today.isClosed).toBe(false);
    expect(today.result).toMatchObject({ shortfallMinutes: 0, lateMinutes: 0, inconsistencies: [] });
    expect(posted.find((p) => p.date === '2026-11-25')!.isClosed).toBe(true);
  });

  it('o dia anterior à admissão não vira falta', async () => {
    const t = await team();
    const emp = await employee(t, { admissionDate: '2026-11-24' });
    const [first] = await punches(t, emp, '2026-11-24', ['07:00', '16:00']);
    await run(punchJob(t, first!));
    expect((await daysOf(emp.id)).map((d) => d.date)).toEqual(['2026-11-24', '2026-11-25']);
  });

  it('período fechado, sem escala, CPF sem cadastro e registro inexistente concluem sem erro; log sem CPF', async () => {
    const t = await team();
    const closed = await employee(t);
    const noSchedule = await employee(t, { schedule: false });
    const stranger = { cpf: fakeCpf() };
    const [a] = await punches(t, closed, '2026-10-15', ['07:00']);
    const [b] = await punches(t, noSchedule, '2026-11-24', ['07:00']);
    const [c] = await punches(t, stranger, '2026-11-24', ['07:00']);
    await closeMonth(t, '2026-10-01', '2026-10-31');
    logLines.length = 0;

    for (const n of [a!, b!, c!, 999_999]) await expect(run(punchJob(t, n))).resolves.toBeUndefined();

    expect(await daysOf(closed.id)).toEqual([]);
    expect(await daysOf(noSchedule.id)).toEqual([]);
    const text = logLines.join('');
    expect(text).toContain('periodo_fechado');
    expect(text).toContain('sem_escala');
    expect(text).toContain('day_recalculation_employee_not_found');
    expect(text).toContain('day_recalculation_record_not_found');
    for (const value of [closed.cpf, noSchedule.cpf, stranger.cpf, 'Pessoa Fictícia']) expect(text).not.toContain(value);
  });

  it('job de outra conta não lê o registro', async () => {
    const t = await team();
    const other = await team();
    const emp = await employee(t);
    const [first] = await punches(t, emp, '2026-11-24', ['07:00']);
    await run(job('recalculate-day', { outboxId: 1, tenantId: other.org.tenantId, establishmentId: t.org.establishmentId, nsr: first }));
    expect(await daysOf(emp.id)).toEqual([]);
  });

  it('erro de banco sobe para a fila só com nome e código; payload inválido não repete', async () => {
    const failing = new PgArpPunchReader({
      query: () => Promise.reject(Object.assign(new Error('Failed query: params: 12345678901'), { code: '57P01' })),
    } as never);
    logLines.length = 0;
    const data = { outboxId: 1, tenantId: 1, establishmentId: 1, nsr: 1 };
    await expect(run(job('recalculate-day', data), { arp: failing })).rejects.toThrow(/^Error 57P01$/);
    expect(logLines.join('')).not.toContain('12345678901');
    await expect(run(job('recalculate-day', { nsr: 'x' }))).rejects.toMatchObject({ name: 'UnrecoverableError' });
    await expect(run(job('outro'))).resolves.toBeUndefined();
  });

  it('dois recálculos do mesmo colaborador não correm juntos (lock até o fim da transação)', async () => {
    const t = await team();
    const emp = await employee(t);
    let active = 0;
    let max = 0;
    const slow: DayPostingHook = {
      apply: async () => {
        active += 1;
        max = Math.max(max, active);
        await new Promise((r) => setTimeout(r, 150));
        active -= 1;
      },
    };
    const service = new TimesheetService(deps({ posting: slow }));
    const record = (await findEmployeeByCpf(h.handle.db, t.org.tenantId, emp.cpf))!;
    const outcomes = await Promise.all([1, 2, 3].map(() => service.recalculateDay(record, '2026-11-24')));
    expect(outcomes).toEqual(['recalculado', 'recalculado', 'recalculado']);
    expect(max).toBe(1);
  });
});

describe('close-days', () => {
  it('falta aparece nos últimos 3 dias; rodar de novo não recalcula; dia calculado aberto é encerrado', async () => {
    const t = await team();
    const absent = await employee(t);
    const open = await employee(t);
    const [first] = await punches(t, open, '2026-11-26', ['07:00', '11:00', '12:00']);
    await run(punchJob(t, first!));
    expect((await byDate(open.id))['2026-11-26']!.issues).toBeNull();

    await run(job('close-days'));
    const days = await daysOf(absent.id);
    expect(days.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
    expect(days.every((d) => d.situation === 'falta' && d.absence === 480)).toBe(true);

    posted.length = 0;
    clock.advance(60 * 60 * 1000);
    await run(job('close-days'));
    expect(posted.filter((p) => p.employeeId === absent.id)).toEqual([]);
    expect(await daysOf(absent.id)).toEqual(days);

    // meia-noite passou: o dia 26, calculado aberto, é encerrado
    clock.set('2026-11-27T04:00:00Z');
    await run(job('close-days'));
    expect((await byDate(open.id))['2026-11-26']!.issues).toEqual(['batidas_impares']);
    expect(posted.find((p) => p.employeeId === open.id && p.date === '2026-11-26')!.isClosed).toBe(true);
    expect((await byDate(absent.id))['2026-11-26']).toMatchObject({ situation: 'falta' });
  });

  it('período fechado não faz o job falhar', async () => {
    const t = await team();
    const emp = await employee(t);
    await closeMonth(t, '2026-11-01', '2026-11-30');
    await expect(run(job('close-days'))).resolves.toBeUndefined();
    expect(await daysOf(emp.id)).toEqual([]);
  });

  it('escala que vira o dia: só encerra 4 h depois da saída prevista', async () => {
    const t = await team();
    const emp = await employee(t, { schedule: false });
    const s = await h.call(t.rh, 'POST', '/portal/schedules', {
      establishmentId: t.org.establishmentId,
      name: 'Noturna',
      type: 'livre',
      cycleType: 'semanal',
      weeklyMinutes: 2400,
      days: [1, 2, 3, 4, 5].map((position) => ({ position, startTime: '22:00', endTime: '06:00', crossesMidnight: true })),
    });
    expect(s.statusCode).toBe(201);
    expect((await h.call(t.rh, 'POST', `/portal/employees/${emp.id}/schedules`, { scheduleId: s.json().data.id, validFrom: '2026-10-01' })).statusCode).toBe(201);

    clock.set('2026-11-26T12:00:00Z'); // 09:00 local: o dia 25 vai até 10:00
    await run(job('close-days'));
    expect((await daysOf(emp.id)).map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24']);

    clock.set('2026-11-26T13:00:00Z');
    await run(job('close-days'));
    expect((await daysOf(emp.id)).map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25']);
  });
});

describe('consumidor com a fila real', () => {
  it('consome recalculate-day publicado como o rep-core, agenda o close-days e fecha limpo', async () => {
    const t = await team();
    const emp = await employee(t);
    const [first] = await punches(t, emp, '2026-11-26', ['07:00', '11:00']);
    const connection = createProducerConnection({ url: valkeyUrl, password: undefined, publishTimeoutMs: 5000 });
    await new Promise((resolve) => connection.once('ready', resolve));
    const queue = createDayRecalculationQueue(connection);
    const consumer = startDayRecalculation({ ...deps(), valkey: { url: valkeyUrl, password: null } });
    try {
      const jobId = postPunchJobId('recalculate-day', t.org.establishmentId, first!);
      const data = { outboxId: 1, tenantId: t.org.tenantId, establishmentId: t.org.establishmentId, nsr: first! };
      const publisher = createOutboxEventQueues(connection).forEvent('recalculate-day');
      await publisher.add('recalculate-day', data, { jobId });
      await waitFor(async () => (await (await queue.getJob(jobId))?.getState()) === 'completed', 'job concluído');
      // o mesmo jobId, concluído e guardado, não roda de novo
      const finishedOn = (await queue.getJob(jobId))!.finishedOn;
      await publisher.add('recalculate-day', data, { jobId });
      expect((await queue.getJob(jobId))!.finishedOn).toBe(finishedOn);

      expect((await queue.getJobSchedulers()).map((s) => s.key)).toEqual(['close-days']);
      // a primeira execução agendada já encerra os dias passados
      await waitFor(async () => (await daysOf(emp.id)).length === 4, 'close-days e recalculate-day aplicados');
      expect((await byDate(emp.id))['2026-11-26']).toMatchObject({ punches: 2, absence: 0 });
      await publisher.close();
    } finally {
      await consumer.close();
      await queue.close();
      connection.disconnect();
    }
  });

  it('com o Valkey fora, o fechamento não trava', async () => {
    const consumer = startDayRecalculation({ ...deps(), valkey: { url: 'redis://127.0.0.1:1', password: null } });
    await new Promise((r) => setTimeout(r, 300));
    await expect(consumer.close()).resolves.toBeUndefined();
  }, 20_000);
});

describe('dia do estabelecimento', () => {
  let t: Team;
  let ana: { id: number; cpf: string };
  let bruno: { id: number; cpf: string };
  let carla: { id: number; cpf: string };
  let semEscala: { id: number; cpf: string };
  const DATE = '2026-11-24';
  const get = (query: string, cookie = t.rh) => h.call(cookie, 'GET', `/portal/timesheets?${query}`);
  const recalc = (body: unknown, cookie = t.rh) => h.call(cookie, 'POST', '/portal/timesheets/recalculate', body);
  const base = () => `date=${DATE}&establishmentId=${t.org.establishmentId}`;

  beforeAll(async () => {
    clock.set(NOW);
    t = await team();
    ana = await employee(t, { name: 'Ana Fictícia' });
    bruno = await employee(t, { name: 'Bruno Fictício' });
    carla = await employee(t, { name: 'Cárla Fictícia' });
    semEscala = await employee(t, { name: 'Davi Fictício', schedule: false });
    await employee(t, { name: 'Fora do Contrato', admissionDate: '2026-11-25' });
    await h.createAssignment(t.org, ana.id);
    await punches(t, ana, DATE, ['07:00', '11:00', '12:00', '17:00']);
    await punches(t, bruno, DATE, ['07:00', '11:00', '12:00']);
  });

  it('recalcula quem estava no contrato e diz quem ficou de fora', async () => {
    const res = await recalc({ establishmentId: t.org.establishmentId, date: DATE });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ recalculated: 3, skipped: [{ employeeId: semEscala.id, reason: 'sem_escala' }] });
    const audit = await h.one<{ n: string }>("SELECT count(*) AS n FROM rh.auditorias WHERE conta_id = $1 AND entidade = 'estabelecimentos'", [t.org.tenantId]);
    expect(Number(audit.n)).toBe(1);
  });

  it('lista com setor, cargo, marcações, falta e contagens; filtros e paginação não mudam as contagens', async () => {
    const res = await get(base());
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.counts).toEqual({ todos: 3, inconsistente: 1, falta: 1, calculada: 1 });
    expect(body.meta).toEqual({ page: 1, pageSize: 25, total: 3 });
    expect(body.data.map((r: { employeeId: number }) => r.employeeId)).toEqual([ana.id, bruno.id, carla.id]);
    expect(body.data[0]).toMatchObject({
      employeeName: 'Ana Fictícia', departmentName: 'Colheita', jobTitleName: 'Operador Rural', date: DATE, situation: 'normal',
      status: 'calculada', isAbsence: false, expectedMinutes: 480, workedMinutes: 540, overtimeMinutes: 60, absenceMinutes: 0, issues: [],
    });
    expect(body.data[0].punches).toHaveLength(4);
    expect(body.data[1]).toMatchObject({ status: 'inconsistente', departmentName: null, issues: [{ type: 'batidas_impares', resolved: false }] });
    expect(body.data[2]).toMatchObject({ situation: 'falta', isAbsence: true, absenceMinutes: 480, punches: [] });
    expect(JSON.stringify(body)).not.toContain(ana.cpf);

    for (const [status, id] of [['calculada', ana.id], ['inconsistente', bruno.id], ['falta', carla.id]] as const) {
      const filtered = (await get(`${base()}&status=${status}`)).json();
      expect(filtered.data.map((r: { employeeId: number }) => r.employeeId)).toEqual([id]);
      expect(filtered.meta.total).toBe(1);
      expect(filtered.counts).toEqual(body.counts);
    }
    const page2 = (await get(`${base()}&page=2&pageSize=2`)).json();
    expect(page2.data.map((r: { employeeId: number }) => r.employeeId)).toEqual([carla.id]);
    expect(page2.meta).toEqual({ page: 2, pageSize: 2, total: 3 });

    const search = (await get(`${base()}&q=carla`)).json();
    expect(search.counts).toEqual({ todos: 1, inconsistente: 0, falta: 1, calculada: 0 });
    const department = (await get(`${base()}&departmentId=${t.org.departmentId}`)).json();
    expect(department.data.map((r: { employeeId: number }) => r.employeeId)).toEqual([ana.id]);
    expect(department.counts.todos).toBe(1);
    h.expectLogsWithout(ana.cpf, 'carla');
  });

  it('perfis e escopo: admin só consulta; fora do escopo ou de outra conta → 404', async () => {
    const body = { establishmentId: t.org.establishmentId, date: DATE };
    const admin = (await h.loginAs(t.org, 'admin')).cookie;
    expect((await get(base(), admin)).statusCode).toBe(200);
    expect((await recalc(body, admin)).statusCode).toBe(403);
    for (const role of ['contador', 'gestor'] as const) {
      const cookie = (await h.loginAs(t.org, role)).cookie;
      expect((await get(base(), cookie)).statusCode).toBe(403);
      expect((await recalc(body, cookie)).statusCode).toBe(403);
    }
    const scoped = (await h.loginAs(t.org, 'rh', { establishments: [t.org.otherEstablishmentId] })).cookie;
    expect((await get(base(), scoped)).statusCode).toBe(404);
    expect((await recalc(body, scoped)).statusCode).toBe(404);
    const other = await team();
    expect((await get(base(), other.rh)).statusCode).toBe(404);
    expect((await recalc(body, other.rh)).statusCode).toBe(404);
    expect((await get(`date=${DATE}`)).statusCode).toBe(400);
  });

  it('gestor (módulo ligado) vê só a equipe', async () => {
    await h.client.query('UPDATE rh.colaboradores SET gestor_id = $2 WHERE id = $1', [bruno.id, ana.id]);
    const app = await h.newApp({ gestorEnabled: true });
    try {
      const gestor = (await h.loginAs(t.org, 'gestor', { employeeId: ana.id, app })).cookie;
      const res = await h.call(gestor, 'GET', `/portal/timesheets?${base()}`, undefined, app);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((r: { employeeId: number }) => r.employeeId)).toEqual([bruno.id]);
      expect(res.json().counts.todos).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('período fechado: todos ficam de fora, sem erro', async () => {
    await closeMonth(t, '2026-10-01', '2026-10-31');
    const res = await recalc({ establishmentId: t.org.establishmentId, date: '2026-10-15' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.recalculated).toBe(0);
    expect(res.json().data.skipped.map((s: { reason: string }) => s.reason)).toEqual(Array(4).fill('periodo_fechado'));
  });
});
