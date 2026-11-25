/**
 * Mock de employee-portal (dono: lote D). Mesmo contrato de endpoints/employee-portal.ts, com dados fictícios
 * convertidos de mocks/data/design.ts. Erros no formato da api (mockFail): 404 fora do escopo, 409, 422.
 *
 * O colaborador é sempre o da sessão de mock ('101', João Pereira): nenhuma função recebe employeeId.
 * "Hoje" no mock é 2026-11-21 (dia de referência do design); dias depois dele não têm apuração.
 */
import type {
  AccrualPeriod, Adjustment, Mirror, MyCertificate, MyMirrorSummary, Punch, TimeBank, TimesheetDay, Vacation,
} from '../contracts';
import type { EmployeePortalApi } from '../endpoints/employee-portal';
import { addCivilDays, monthRange } from '../../format';
import { clone, delay, mockFail, mockId, mockNotFound } from './runtime';

const EMPLOYEE_ID = '101';
export const MOCK_TODAY = '2026-11-21';
const BASE_INSTANT = `${MOCK_TODAY}T13:00:00.000Z`;

// ---- apuração ----

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

function buildPunches(date: string, times: string[], treated = false): Punch[] {
  return times.map((t, i) => ({
    sequence: i + 1,
    at: `${date}T${t}:00-03:00`,
    origin: treated && i === 1 ? 'tratada' : 'original',
    nsr: treated && i === 1 ? null : 1000 + i,
    adjustmentId: treated && i === 1 ? '801' : null,
  }));
}

function workedOf(times: string[]): number {
  let total = 0;
  for (let i = 0; i + 1 < times.length; i += 2) total += toMin(times[i + 1]!) - toMin(times[i]!);
  return total;
}

function makeDay(date: string, situation: string, times: string[], o: Partial<TimesheetDay> = {}, treated = false): TimesheetDay {
  return {
    date,
    situation,
    status: times.length % 2 === 1 && date !== MOCK_TODAY ? 'inconsistente' : 'calculada',
    scheduleId: '1',
    expectedMinutes: situation === 'normal' ? 440 : 0,
    workedMinutes: workedOf(times),
    absenceMinutes: 0,
    lateMinutes: 0,
    overtime50Minutes: 0,
    overtime100Minutes: 0,
    nightMinutes: 0,
    breakMinutes: times.length >= 4 ? toMin(times[2]!) - toMin(times[1]!) : 0,
    parameterVersion: '2026.1',
    calculatedAt: BASE_INSTANT,
    punches: buildPunches(date, times, treated),
    issues: [],
    ...o,
  };
}

/** Dias fixos do design (15 a 21/11). */
const DESIGN_DAYS: Record<string, () => TimesheetDay> = {
  '2026-11-21': () => makeDay('2026-11-21', 'normal', ['06:58', '11:01', '12:00'], { expectedMinutes: 440 }),
  '2026-11-20': () => makeDay('2026-11-20', 'feriado', []),
  '2026-11-19': () => makeDay('2026-11-19', 'normal', ['06:58', '11:00', '12:01', '15:21']),
  '2026-11-18': () => makeDay('2026-11-18', 'normal', ['06:59', '11:02', '12:00', '15:20'], {}, true),
  '2026-11-17': () => makeDay('2026-11-17', 'normal', ['06:58', '11:00', '12:00', '15:20']),
  '2026-11-16': () => makeDay('2026-11-16', 'normal', ['06:56', '11:00', '12:00', '18:10'], { overtime50Minutes: 174 }),
  '2026-11-15': () => makeDay('2026-11-15', 'folga', []),
};

function dayOfWeek(civil: string): number {
  return new Date(`${civil}T12:00:00Z`).getUTCDay();
}

function dayFor(date: string): TimesheetDay | null {
  if (date > MOCK_TODAY) return null;
  const fixed = DESIGN_DAYS[date];
  if (fixed) return fixed();
  if (dayOfWeek(date) === 0) return makeDay(date, 'folga', []);
  return makeDay(date, 'normal', ['06:58', '11:00', '12:00', '15:20']);
}

function timesheets(from: string, to: string): TimesheetDay[] {
  if (to < from) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'to', message: 'a data final não pode ser antes da inicial' }]);
  const out: TimesheetDay[] = [];
  for (let d = from, n = 0; d <= to && n < 400; d = addCivilDays(d, 1), n += 1) {
    const day = dayFor(d);
    if (day) out.push(day);
  }
  return out;
}

// ---- banco de horas ----

const initialTimeBank = (): TimeBank => ({
  balanceMinutes: 400,
  expiringIn30DaysMinutes: 80,
  entries: [
    { date: '2026-11-16', type: 'credito', minutes: 174, dueDate: '2027-05-16' },
    { date: '2026-10-09', type: 'credito', minutes: 80, dueDate: '2026-12-31' },
  ],
});

// ---- espelhos ----

const initialMirrors = (): MyMirrorSummary[] => [
  { closingId: '502', referenceMonth: '2026-10', status: 'fechado', acknowledgedAt: null },
  { closingId: '501', referenceMonth: '2026-09', status: 'fechado', acknowledgedAt: '2026-10-04T10:12:00.000Z' },
];

// ---- férias ----

const initialPeriods = (): AccrualPeriod[] => [
  {
    id: '701', employeeId: EMPLOYEE_ID, startDate: '2025-03-01', endDate: '2026-02-28', grantDeadline: '2027-02-28',
    unjustifiedAbsences: 0, entitledDays: 30, status: 'aberto', remainingDays: 19,
    vacations: [
      {
        id: '901', accrualPeriodId: '701', employeeId: EMPLOYEE_ID, departmentId: '10', startDate: '2026-12-21', endDate: '2026-12-31',
        days: 11, cashBonusDays: 0, status: 'aprovada', requestedAt: '2026-10-20T12:00:00.000Z', decidedAt: '2026-10-22T12:00:00.000Z',
        decisionReason: null, daysPaidInDouble: 0,
      },
      {
        id: '900', accrualPeriodId: '701', employeeId: EMPLOYEE_ID, departmentId: '10', startDate: '2026-04-06', endDate: '2026-04-06',
        days: 1, cashBonusDays: 0, status: 'recusada', requestedAt: '2026-03-10T12:00:00.000Z', decidedAt: '2026-03-12T12:00:00.000Z',
        decisionReason: 'O setor já estava com o limite de pessoas em férias nessas datas.', daysPaidInDouble: 0,
      },
    ],
  },
  {
    id: '700', employeeId: EMPLOYEE_ID, startDate: '2024-03-01', endDate: '2025-02-28', grantDeadline: '2026-02-28',
    unjustifiedAbsences: 0, entitledDays: 30, status: 'gozado', remainingDays: 0,
    vacations: [
      {
        id: '899', accrualPeriodId: '700', employeeId: EMPLOYEE_ID, departmentId: '10', startDate: '2025-07-07', endDate: '2025-07-26',
        days: 20, cashBonusDays: 10, status: 'gozada', requestedAt: '2025-05-02T12:00:00.000Z', decidedAt: '2025-05-05T12:00:00.000Z',
        decisionReason: null, daysPaidInDouble: 0,
      },
    ],
  },
];

const inclusive = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;

// ---- atestados ----

const initialCertificates = (): MyCertificate[] => [
  { id: '3002', employeeId: EMPLOYEE_ID, startDate: '2026-11-17', days: 1, hours: null, status: 'pendente', sentAt: '2026-11-18T11:30:00.000Z', decidedAt: null, decisionReason: null },
  { id: '3001', employeeId: EMPLOYEE_ID, startDate: '2026-10-12', days: 2, hours: null, status: 'recusado', sentAt: '2026-10-14T09:00:00.000Z', decidedAt: '2026-10-15T14:00:00.000Z', decisionReason: 'A imagem estava cortada e não dava para ler a data. Envie uma foto inteira do atestado.' },
  { id: '3000', employeeId: EMPLOYEE_ID, startDate: '2026-09-02', days: 2, hours: null, status: 'aprovado', sentAt: '2026-09-03T08:00:00.000Z', decidedAt: '2026-09-03T15:00:00.000Z', decisionReason: null },
];


const fieldError = (path: string, message: string) => ({ path, message });
const isCivil = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Competência fechada no mock: outubro e setembro. Pedir ajuste nelas é 409 (como o back). */
const CLOSED_MONTHS = ['2026-10', '2026-09'];

let timeBank = initialTimeBank();
let mirrors = initialMirrors();
let accrualPeriods = initialPeriods();
let certificates = initialCertificates();
let adjustments: Adjustment[] = [];

/** Volta o mock ao estado inicial (usado nos testes, que mexem no estado em memória). */
export function resetEmployeePortalMock() {
  timeBank = initialTimeBank();
  mirrors = initialMirrors();
  accrualPeriods = initialPeriods();
  certificates = initialCertificates();
  adjustments = [];
}

export const mockEmployeePortalApi: EmployeePortalApi = {
  timesheets: async (q) => {
    await delay();
    return clone(timesheets(q.from, q.to));
  },
  timeBank: async () => {
    await delay();
    return clone(timeBank);
  },
  mirrors: async () => {
    await delay();
    return clone(mirrors.map(({ closingId, referenceMonth, status, acknowledgedAt }) => ({ closingId, referenceMonth, status, acknowledgedAt })));
  },
  mirror: async (closingId): Promise<Mirror> => {
    await delay();
    const m = mirrors.find((x) => x.closingId === closingId);
    if (!m) throw mockNotFound();
    const { from, to } = monthRange(m.referenceMonth);
    const days = timesheets(from, to);
    const sum = (pick: (d: TimesheetDay) => number) => days.reduce((acc, d) => acc + pick(d), 0);
    return clone({
      closing: { id: m.closingId, establishmentId: '1', referenceMonth: m.referenceMonth, startDate: from, endDate: to, status: m.status, closedAt: BASE_INSTANT, reopenedAt: null, reopenReason: null },
      employee: { id: EMPLOYEE_ID, name: 'João Pereira', cpf: '***.***.***-01', registrationNumber: '00401' },
      days,
      totals: {
        expectedMinutes: sum((d) => d.expectedMinutes), workedMinutes: sum((d) => d.workedMinutes), absenceMinutes: sum((d) => d.absenceMinutes),
        lateMinutes: sum((d) => d.lateMinutes), overtime50Minutes: sum((d) => d.overtime50Minutes), overtime100Minutes: sum((d) => d.overtime100Minutes),
        nightMinutes: sum((d) => d.nightMinutes),
      },
      timeBank: { balanceMinutes: timeBank.balanceMinutes, periodEntries: [] },
      pdfUrl: null,
      acknowledgedAt: m.acknowledgedAt,
    });
  },
  acknowledge: async (closingId) => {
    await delay();
    const m = mirrors.find((x) => x.closingId === closingId);
    if (!m) throw mockNotFound();
    if (m.status !== 'fechado') throw mockFail(409, 'STATUS_INVALIDO', 'A competência foi reaberta: aguarde o novo fechamento');
    if (m.acknowledgedAt) throw mockFail(409, 'STATUS_INVALIDO', 'A ciência deste espelho já foi registrada');
    m.acknowledgedAt = BASE_INSTANT;
    return { closingId: m.closingId, acknowledgedAt: m.acknowledgedAt };
  },
  requestAdjustment: async (body) => {
    await delay();
    const details: { path: string; message: string }[] = [];
    if (!isCivil(body.date)) details.push(fieldError('date', 'data inválida'));
    const reason = body.reason?.trim() ?? '';
    if (reason.length < 3) details.push(fieldError('reason', 'escreva o motivo'));
    if (reason.length > 500) details.push(fieldError('reason', 'no máximo 500 caracteres'));
    if (body.type === 'inclusao_batida' && !body.proposedAt) details.push(fieldError('proposedAt', 'inclusão de batida exige o horário'));
    if (body.type !== 'inclusao_batida' && body.proposedAt) details.push(fieldError('proposedAt', 'só a inclusão de batida tem horário'));
    if (details.length > 0) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', details);
    if (CLOSED_MONTHS.includes(body.date.slice(0, 7))) throw mockFail(409, 'PERIODO_FECHADO', 'O período está fechado: reabra antes de alterar');
    const created: Adjustment = {
      id: mockId(), employeeId: EMPLOYEE_ID, date: body.date, type: body.type, proposedAt: body.proposedAt ?? null, reason,
      status: 'pendente', requestedById: '5', requestedAt: BASE_INSTANT, decidedById: null, decidedAt: null, decisionReason: null,
    };
    adjustments.push(created);
    return clone(created);
  },
  vacations: async () => {
    await delay();
    return clone(accrualPeriods);
  },
  requestVacation: async (body) => {
    await delay();
    const period = accrualPeriods.find((p) => p.id === body.accrualPeriodId);
    if (!period) throw mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [fieldError('accrualPeriodId', 'período aquisitivo não encontrado')]);
    const details: { path: string; message: string }[] = [];
    if (!isCivil(body.startDate)) details.push(fieldError('startDate', 'data inválida'));
    if (!isCivil(body.endDate)) details.push(fieldError('endDate', 'data inválida'));
    if (isCivil(body.startDate) && isCivil(body.endDate) && body.endDate < body.startDate) details.push(fieldError('endDate', 'não pode ser antes do início'));
    const bonus = body.cashBonusDays ?? 0;
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > 10) details.push(fieldError('cashBonusDays', 'de 0 a 10 dias'));
    if (details.length > 0) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', details);
    // Demonstra o erro de setor desfalcado: qualquer pedido que encoste em 21 a 31/12.
    if (body.startDate <= '2026-12-31' && body.endDate >= '2026-12-21') {
      throw mockFail(409, 'FERIAS_SETOR_DESFALCADO', 'O setor ficaria desfalcado nesse intervalo. Escolha outras datas.');
    }
    const days = inclusive(body.startDate, body.endDate);
    if (days + bonus > period.remainingDays) throw mockFail(409, 'FERIAS_SALDO_INSUFICIENTE', 'Os dias pedidos passam do direito do período aquisitivo');
    if (bonus > Math.floor(period.entitledDays / 3)) throw mockFail(409, 'FERIAS_ABONO_ACIMA_LIMITE', 'O abono passa de 1/3 do direito');
    const created: Vacation = {
      id: mockId(), accrualPeriodId: period.id, employeeId: EMPLOYEE_ID, departmentId: '10', startDate: body.startDate, endDate: body.endDate,
      days, cashBonusDays: bonus, status: 'solicitada', requestedAt: BASE_INSTANT, decidedAt: null, decisionReason: null, daysPaidInDouble: 0,
    };
    period.vacations.push(created);
    return clone(created);
  },
  certificates: async () => {
    await delay();
    // Só o que o colaborador pode ver (RF27): nada de CID, análise ou risco.
    return clone(certificates);
  },
  submitCertificate: async (input) => {
    await delay();
    const details: { path: string; message: string }[] = [];
    if (!isCivil(input.startDate)) details.push(fieldError('startDate', 'data inválida'));
    const hasDays = input.days !== undefined;
    const hasHours = input.hours !== undefined;
    if (hasDays === hasHours) details.push(fieldError(hasDays ? 'hours' : 'days', 'informe os dias ou as horas, só um dos dois'));
    if (hasDays && (!Number.isInteger(input.days) || input.days! < 1 || input.days! > 365)) details.push(fieldError('days', 'de 1 a 365 dias'));
    if (hasHours && (!Number.isInteger(input.hours) || input.hours! < 1 || input.hours! > 24)) details.push(fieldError('hours', 'de 1 a 24 horas'));
    if (input.file.size === 0) details.push(fieldError('file', 'envie o atestado'));
    if (details.length > 0) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', details);
    if (certificates.some((c) => c.startDate === input.startDate && c.status === 'pendente' && input.file.name === 'duplicado.pdf')) {
      throw mockFail(409, 'ATESTADO_DUPLICADO', 'Esse arquivo de atestado já foi enviado');
    }
    const created: MyCertificate = {
      id: mockId(), employeeId: EMPLOYEE_ID, startDate: input.startDate, days: input.days ?? null, hours: input.hours ?? null,
      status: 'pendente', sentAt: BASE_INSTANT, decidedAt: null, decisionReason: null,
    };
    certificates.unshift(created);
    return clone(created);
  },
};
