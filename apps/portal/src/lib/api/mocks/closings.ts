/**
 * Mock de closings (dono: lote G). Mesmo contrato de endpoints/closings.ts. Aqui o mock faz o papel do
 * servidor: o fechamento pode ser recusado por pendência, a reabertura apaga a ciência e os totais do
 * espelho são somados dos dias. Esta aritmética NÃO existe no portal. Erros com os códigos reais da api
 * (apps/api/src/modules/closing/service.ts e http/domain-errors.ts).
 */
import type { Closing, GenerateMirrorsResult, Mirror, MirrorTotals, Punch, TimesheetDay } from '../contracts';
import type { ClosingsApi } from '../endpoints/closings';
import { clone, delay, mockFail, mockId, mockNotFound } from './runtime';
import { SEED_EMPLOYEES, type SeedEmployee } from './seed';

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  return `${month}-${String(last).padStart(2, '0')}`;
};

interface Row {
  closing: Closing;
  /** employeeId → ciência (ISO) ou null. Ausente = espelho ainda não emitido. */
  mirrors: Map<string, string | null>;
}

const base = (id: string, establishmentId: string, month: string, over: Partial<Closing> = {}): Closing => ({
  id, establishmentId, referenceMonth: month, startDate: `${month}-01`, endDate: monthEnd(month),
  status: 'aberto', closedAt: null, reopenedAt: null, reopenReason: null, ...over,
});

const employeesOf = (establishmentId: string) => SEED_EMPLOYEES.filter((e) => e.establishmentId === establishmentId && e.status === 'ativo');

function mirrorsFor(establishmentId: string, acknowledgedAt: string | null, everyOther = false): Map<string, string | null> {
  return new Map(employeesOf(establishmentId).map((e, i) => [e.id, everyOther && i % 2 === 1 ? null : acknowledgedAt]));
}

function seed(): Row[] {
  return [
    { closing: base('501', '1', '2026-09', { status: 'fechado', closedAt: '2026-10-03T15:00:00-03:00' }), mirrors: mirrorsFor('1', '2026-10-06T09:30:00-03:00') },
    { closing: base('502', '1', '2026-10', { status: 'fechado', closedAt: '2026-11-04T15:00:00-03:00' }), mirrors: mirrorsFor('1', '2026-11-09T10:15:00-03:00', true) },
    { closing: base('503', '1', '2026-11'), mirrors: new Map() },
    { closing: base('504', '2', '2026-10', { status: 'fechado', closedAt: '2026-11-05T11:00:00-03:00' }), mirrors: mirrorsFor('2', null) },
  ];
}

let rows = seed();
/** Enquanto falso, fechar a competência aberta de novembro é recusado por pendências (caminho de bloqueio). */
let pendenciesCleared = false;

/** Para testes e demonstração: some com as pendências que travam o fechamento. */
export const clearMockClosingPendencies = () => {
  pendenciesCleared = true;
};
/** Para testes: volta ao estado inicial do mock. */
export const resetMockClosings = () => {
  rows = seed();
  pendenciesCleared = false;
};

const find = (id: string) => {
  const r = rows.find((x) => x.closing.id === id);
  if (!r) throw mockNotFound();
  return r;
};

/** Competência fechada que cobre o dia (o mock de timesheets deixa esses dias fora do recálculo). */
export const isMockPeriodClosed = (establishmentId: string, date: string) =>
  rows.some((r) => r.closing.establishmentId === establishmentId && r.closing.status === 'fechado' && r.closing.startDate <= date && date <= r.closing.endDate);

// ---- espelho ----

const instant = (date: string, hhmm: string) => `${date}T${hhmm}:00-03:00`;
const civilUtc = (civil: string) => {
  const [y, m, d] = civil.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const weekdayOf = (civil: string) => new Date(civilUtc(civil)).getUTCDay();
const EXPECTED = 440;

const VARIANTS: Record<'normal' | 'extra' | 'atraso', { times: string[]; worked: number; late: number; overtime50: number }> = {
  normal: { times: ['07:00', '11:00', '12:00', '15:20'], worked: 440, late: 0, overtime50: 0 },
  extra: { times: ['07:00', '11:00', '12:00', '16:00'], worked: 480, late: 0, overtime50: 40 },
  atraso: { times: ['07:10', '11:00', '12:00', '15:20'], worked: 430, late: 10, overtime50: 0 },
};

function buildDay(employee: SeedEmployee, date: string, index: number): TimesheetDay {
  const dow = weekdayOf(date);
  const weekend = dow === 0 || dow === 6;
  const key = (Number(employee.id) + index) % 7;
  const v = weekend ? null : VARIANTS[key === 5 ? 'extra' : key === 6 ? 'atraso' : 'normal'];
  const punches: Punch[] = (v?.times ?? []).map((t, i) => ({
    sequence: i + 1, at: instant(date, t), origin: 'original', nsr: 10_000 + index * 4 + i, adjustmentId: null,
  }));
  return {
    date,
    situation: weekend ? 'folga' : 'normal',
    status: 'calculada',
    scheduleId: '1',
    expectedMinutes: weekend ? 0 : EXPECTED,
    workedMinutes: v?.worked ?? 0,
    absenceMinutes: 0,
    lateMinutes: v?.late ?? 0,
    overtime50Minutes: v?.overtime50 ?? 0,
    overtime100Minutes: 0,
    nightMinutes: 0,
    breakMinutes: v ? 60 : 0,
    parameterVersion: '2026.11',
    calculatedAt: instant(date, '22:00'),
    punches,
    issues: [],
  };
}

const KEYS: (keyof MirrorTotals)[] = ['expectedMinutes', 'workedMinutes', 'absenceMinutes', 'lateMinutes', 'overtime50Minutes', 'overtime100Minutes', 'nightMinutes'];

function buildMirror(row: Row, employee: SeedEmployee, acknowledgedAt: string | null): Mirror {
  const c = row.closing;
  const days: TimesheetDay[] = [];
  const lastDay = Number(c.endDate.slice(8));
  for (let d = 1; d <= lastDay; d++) days.push(buildDay(employee, `${c.referenceMonth}-${String(d).padStart(2, '0')}`, d));
  const totals = Object.fromEntries(KEYS.map((k) => [k, days.reduce((s, x) => s + x[k], 0)])) as unknown as MirrorTotals;
  const n = Number(employee.id);
  return {
    closing: clone(c),
    employee: { id: employee.id, name: employee.name, cpf: `***.***.***-${employee.cpf.slice(-2)}`, registrationNumber: employee.registrationNumber },
    days,
    totals,
    timeBank: {
      balanceMinutes: ((n * 37) % 600) - 150,
      periodEntries: [{ date: `${c.referenceMonth}-10`, type: 'credito', minutes: 60 + (n % 5) * 30 }],
    },
    pdfUrl: null,
    acknowledgedAt,
  };
}

// ---- api ----

export const mockClosingsApi: ClosingsApi = {
  list: async (q) => {
    await delay();
    return clone(rows.filter((r) => !q.establishmentId || r.closing.establishmentId === q.establishmentId).map((r) => r.closing));
  },
  create: async (body) => {
    await delay();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.referenceMonth)) {
      throw mockFail(400, 'VALIDATION', 'Dados inválidos', [{ path: 'referenceMonth', message: 'Use o formato AAAA-MM' }]);
    }
    if (!SEED_EMPLOYEES.some((e) => e.establishmentId === body.establishmentId)) {
      throw mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'establishmentId', message: 'estabelecimento não encontrado' }]);
    }
    if (rows.some((r) => r.closing.establishmentId === body.establishmentId && r.closing.referenceMonth === body.referenceMonth)) {
      throw mockFail(409, 'FECHAMENTO_DUPLICADO', 'Essa competência já existe para o estabelecimento');
    }
    const row: Row = { closing: base(mockId(), body.establishmentId, body.referenceMonth), mirrors: new Map() };
    rows.push(row);
    return clone(row.closing);
  },
  close: async (id) => {
    await delay();
    const r = find(id);
    if (r.closing.status === 'fechado') throw mockFail(409, 'STATUS_INVALIDO', 'A competência já está fechada');
    if (r.closing.referenceMonth === '2026-11' && !pendenciesCleared) {
      throw mockFail(409, 'FECHAMENTO_COM_PENDENCIAS', 'Há inconsistências abertas ou ajustes pendentes no período', [
        { path: 'issues', message: '3' },
        { path: 'adjustments', message: '2' },
      ]);
    }
    r.closing = { ...r.closing, status: 'fechado', closedAt: '2026-11-24T10:00:00-03:00' };
    return clone(r.closing);
  },
  reopen: async (id, body) => {
    await delay();
    const r = find(id);
    const reason = body.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw mockFail(400, 'VALIDATION', 'Dados inválidos', [{ path: 'reason', message: 'O motivo deve ter de 3 a 500 caracteres' }]);
    }
    if (r.closing.status !== 'fechado') throw mockFail(409, 'STATUS_INVALIDO', 'Só uma competência fechada pode ser reaberta');
    r.closing = { ...r.closing, status: 'reaberto', reopenedAt: '2026-11-24T10:00:00-03:00', reopenReason: reason };
    // Reabrir apaga a ciência dos espelhos já dados.
    for (const k of r.mirrors.keys()) r.mirrors.set(k, null);
    return clone(r.closing);
  },
  generateMirrors: async (id) => {
    await delay();
    const r = find(id);
    if (r.closing.status !== 'fechado') throw mockFail(409, 'STATUS_INVALIDO', 'Feche a competência antes de emitir os espelhos');
    const people = employeesOf(r.closing.establishmentId);
    for (const e of people) if (!r.mirrors.has(e.id)) r.mirrors.set(e.id, null);
    const result: GenerateMirrorsResult = { generated: people.length, total: people.length };
    return result;
  },
  mirror: async (id, employeeId) => {
    await delay();
    const r = find(id);
    const e = employeesOf(r.closing.establishmentId).find((x) => x.id === employeeId);
    if (!e || !r.mirrors.has(employeeId)) throw mockNotFound();
    return buildMirror(r, e, r.mirrors.get(employeeId) ?? null);
  },
};
