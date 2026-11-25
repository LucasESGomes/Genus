/**
 * Mock de vacations (dono: lote F). Mesmo contrato de endpoints/vacations.ts, com dados fictícios.
 *
 * O mock faz o papel do servidor: calcula dias, ocupação diária, `exceedsLimit` e a próxima janela livre
 * (esta aritmética NÃO existe no portal). O calendário de dezembro/2026 vem de `designVacationSectors`
 * (SETORES_FER do design); os outros meses têm poucos pedidos determinísticos.
 * Erros: códigos e mensagens de apps/api/src/http/domain-errors.ts (FERIAS_*, STATUS_INVALIDO).
 * [A CONFIRMAR] `nextFreeStartDate` e o endpoint do calendário não existem no back (portal-mapa-front §6).
 */
import { systemClock } from '../../clock';
import type { AccrualPeriod, EntityId, Vacation, VacationCalendar, VacationCalendarRow, VacationStatus } from '../contracts';
import type { VacationsApi } from '../endpoints/vacations';
import { designVacationSectors } from './data/design';
import { clone, delay, mockFail, mockId, mockNotFound } from './runtime';
import { departmentIdOf, SEED_EMPLOYEES, seedEmployee } from './seed';

const DAY_MS = 86_400_000;
const utc = (civil: string) => {
  const [y, m, d] = civil.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const civilOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (civil: string, n: number) => civilOf(utc(civil) + n * DAY_MS);
const spanDays = (start: string, end: string) => Math.round((utc(end) - utc(start)) / DAY_MS) + 1;
const addYears = (civil: string, n: number) => `${Number(civil.slice(0, 4)) + n}${civil.slice(4)}`;

/** Setores do calendário: limite de simultâneos e total de colaboradores (design: SETORES_FER). */
const SECTORS = Object.entries(designVacationSectors).map(([name, s]) => ({
  name, departmentId: departmentIdOf(name), maxSimultaneous: s.limite, headcount: s.total,
}));
const sectorOf = (departmentId: EntityId) => SECTORS.find((s) => s.departmentId === departmentId);

const STATUS_FROM_DESIGN: Record<string, VacationStatus> = { aprovado: 'aprovada', pendente: 'solicitada', recusado: 'recusada' };
const employeeByName = (name: string) => SEED_EMPLOYEES.find((e) => e.name === name);

interface Draft { employeeName: string; sector: keyof typeof designVacationSectors; start: string; end: string; status: VacationStatus; reason?: string }

function drafts(): Draft[] {
  const out: Draft[] = [];
  for (const [sector, s] of Object.entries(designVacationSectors) as [keyof typeof designVacationSectors, (typeof designVacationSectors)[keyof typeof designVacationSectors]][]) {
    for (const r of s.rows) {
      const day = (n: number) => `2026-12-${String(n).padStart(2, '0')}`;
      const quando = 'quando' in r ? r.quando : undefined;
      out.push({
        employeeName: r.nome, sector, start: day(r.ini), end: day(r.fim), status: STATUS_FROM_DESIGN[r.st] ?? 'solicitada',
        ...(r.st === 'recusado' ? { reason: `Recusado em ${quando ?? 'hoje'}: o setor já tem o limite de colaboradores em férias nesse intervalo.` } : {}),
      });
    }
  }
  // Outros meses (poucos pedidos, determinísticos).
  out.push(
    { employeeName: 'Daniela Costa', sector: 'Ordenha', start: '2026-11-02', end: '2026-11-13', status: 'gozada' },
    { employeeName: 'Antônio Carlos Ferreira', sector: 'Colheita', start: '2026-11-09', end: '2026-11-20', status: 'gozada' },
    { employeeName: 'Marcos Vinícius Rocha', sector: 'Agroindústria', start: '2026-11-16', end: '2026-11-27', status: 'aprovada' },
    { employeeName: 'Joana Ribeiro', sector: 'Ordenha', start: '2027-01-04', end: '2027-01-18', status: 'solicitada' },
    { employeeName: 'Edson Barbosa Nunes', sector: 'Colheita', start: '2027-01-11', end: '2027-01-30', status: 'aprovada' },
  );
  return out;
}

/** Último período aquisitivo completo de cada colaborador (aniversário de admissão em 2025). */
const absencesOf = (employeeId: string) => (Number(employeeId) % 5 === 0 ? 7 : 1);
const entitledOf = (absences: number) => (absences > 5 ? 24 : 30);

/** IDs do estado inicial: fixos (recomeçam a cada `build`), para os testes não dependerem de ordem. */
let seedSeq = 0;
const seedId = () => String(++seedSeq);

function periodFor(employeeId: EntityId, startDate: string, id: EntityId = mockId()): AccrualPeriod {
  const absences = absencesOf(employeeId);
  const end = addDays(addYears(startDate, 1), -1);
  return {
    id, employeeId, startDate, endDate: end, grantDeadline: addYears(end, 1), unjustifiedAbsences: absences,
    entitledDays: entitledOf(absences), status: 'aberto', remainingDays: 0, vacations: [],
  };
}

let periods: AccrualPeriod[] = [];
let vacations: Vacation[] = [];

function build() {
  periods = [];
  vacations = [];
  seedSeq = 0;
  const periodOf = new Map<string, AccrualPeriod>();
  for (const e of SEED_EMPLOYEES.filter((x) => x.establishmentId === '1' && x.admissionDate < '2025-01-01')) {
    const anniversary = `2025${e.admissionDate.slice(4)}`;
    const p = periodFor(e.id, anniversary, seedId());
    periods.push(p);
    periodOf.set(e.id, p);
  }
  for (const d of drafts()) {
    const emp = employeeByName(d.employeeName);
    const period = emp ? periodOf.get(emp.id) : undefined;
    if (!emp || !period) continue;
    const v: Vacation = {
      id: seedId(), accrualPeriodId: period.id, employeeId: emp.id, departmentId: departmentIdOf(d.sector), startDate: d.start, endDate: d.end,
      days: spanDays(d.start, d.end), cashBonusDays: 0, status: d.status, requestedAt: '2026-11-10T09:00:00-03:00',
      decidedAt: d.status === 'solicitada' ? null : '2026-11-18T10:30:00-03:00', decisionReason: d.reason ?? null, daysPaidInDouble: 0,
    };
    vacations.push(v);
  }
}
build();

/** Volta ao estado inicial (testes). */
export function resetMockVacations() {
  build();
}

const sameSet = (s: VacationStatus) => s === 'aprovada' || s === 'gozada';

/** Quantas pessoas do setor estão fora no dia, contando só férias aprovadas ou gozadas. */
function occupancyOn(departmentId: EntityId, day: string, ignoreId?: EntityId): number {
  return vacations.filter((v) => v.departmentId === departmentId && v.id !== ignoreId && sameSet(v.status) && v.startDate <= day && day <= v.endDate).length;
}

/** Aprovar este pedido passaria do limite do setor em algum dia? */
function exceeds(v: Vacation, start = v.startDate, end = v.endDate): boolean {
  const s = sectorOf(v.departmentId);
  if (!s) return false;
  for (let d = start; d <= end; d = addDays(d, 1)) if (occupancyOn(v.departmentId, d, v.id) + 1 > s.maxSimultaneous) return true;
  return false;
}

/** Primeira data (a partir do início pedido) em que o mesmo número de dias cabe no limite. */
function nextFreeStart(v: Vacation): string | null {
  const length = spanDays(v.startDate, v.endDate);
  for (let i = 1; i <= 90; i++) {
    const start = addDays(v.startDate, i);
    if (!exceeds(v, start, addDays(start, length - 1))) return start;
  }
  return null;
}

function toRow(v: Vacation): VacationCalendarRow {
  const emp = seedEmployee(v.employeeId);
  const blocked = (v.status === 'solicitada' || v.status === 'recusada') && exceeds(v);
  return {
    vacationId: v.id, employeeId: v.employeeId, employeeName: emp?.name ?? 'Colaborador', startDate: v.startDate, endDate: v.endDate,
    status: v.status, exceedsLimit: blocked, nextFreeStartDate: blocked ? nextFreeStart(v) : null,
  };
}

const withRemaining = (p: AccrualPeriod): AccrualPeriod => {
  const mine = vacations.filter((v) => v.accrualPeriodId === p.id);
  const used = mine.filter((v) => sameSet(v.status)).reduce((sum, v) => sum + v.days + v.cashBonusDays, 0);
  return { ...p, remainingDays: Math.max(0, p.entitledDays - used), vacations: mine };
};

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && bStart <= aEnd;

function decide(id: EntityId, to: 'aprovada' | 'recusada' | 'cancelada', reason?: string): Vacation {
  const v = vacations.find((x) => x.id === id);
  if (!v) throw mockNotFound();
  const allowed: VacationStatus[] = to === 'cancelada' ? ['solicitada', 'aprovada'] : ['solicitada'];
  if (!allowed.includes(v.status)) throw mockFail(409, 'STATUS_INVALIDO', 'As férias não estão num status que permita essa ação');
  if (to === 'aprovada' && exceeds(v)) {
    const next = nextFreeStart(v);
    throw mockFail(409, 'FERIAS_SETOR_DESFALCADO', 'O setor ficaria desfalcado nesse intervalo', next ? [{ path: 'nextFreeStartDate', message: next }] : undefined);
  }
  if (to !== 'aprovada') {
    const text = (reason ?? '').trim();
    if (text.length < 3 || text.length > 500) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'reason', message: 'de 3 a 500 caracteres' }]);
  }
  v.status = to;
  v.decidedAt = systemClock.now().toISOString();
  v.decisionReason = reason?.trim() || null;
  return clone(v);
}

export const mockVacationsApi: VacationsApi = {
  periods: async (employeeId) => {
    await delay();
    if (!seedEmployee(employeeId)) throw mockNotFound();
    return clone(periods.filter((p) => p.employeeId === employeeId).map(withRemaining));
  },
  createPeriod: async (employeeId, body) => {
    await delay();
    if (!seedEmployee(employeeId)) throw mockNotFound();
    const last = periods.filter((p) => p.employeeId === employeeId).at(-1);
    const end = addDays(addYears(body.startDate, 1), -1);
    if (periods.some((p) => p.employeeId === employeeId && overlaps(p.startDate, p.endDate, body.startDate, end))) {
      throw mockFail(409, 'PERIODO_AQUISITIVO_SOBREPOSTO', 'O período aquisitivo se sobrepõe a outro do colaborador');
    }
    const created = periodFor(employeeId, body.startDate);
    if (last && created.startDate < last.startDate) periods.unshift(created);
    else periods.push(created);
    return clone(withRemaining(created));
  },
  request: async (employeeId, body) => {
    await delay();
    const emp = seedEmployee(employeeId);
    if (!emp) throw mockNotFound();
    const period = periods.find((p) => p.id === body.accrualPeriodId && p.employeeId === employeeId);
    if (!period) throw mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'accrualPeriodId', message: 'período aquisitivo não encontrado' }]);
    if (body.endDate < body.startDate) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'endDate', message: 'fim antes do início' }]);
    const cash = body.cashBonusDays ?? 0;
    const days = spanDays(body.startDate, body.endDate);
    if (cash > 10) throw mockFail(409, 'FERIAS_ABONO_ACIMA_LIMITE', 'O abono passa de 1/3 do direito');
    if (days + cash > withRemaining(period).remainingDays) throw mockFail(409, 'FERIAS_SALDO_INSUFICIENTE', 'Os dias pedidos passam do direito do período aquisitivo');
    if (vacations.some((v) => v.employeeId === employeeId && v.status === 'aprovada' && overlaps(v.startDate, v.endDate, body.startDate, body.endDate))) {
      throw mockFail(409, 'FERIAS_SOBREPOSTAS', 'As férias se sobrepõem a outras férias aprovadas do colaborador');
    }
    const created: Vacation = {
      id: mockId(), accrualPeriodId: period.id, employeeId, departmentId: departmentIdOf(emp.departmentName), startDate: body.startDate,
      endDate: body.endDate, days, cashBonusDays: cash, status: 'solicitada', requestedAt: systemClock.now().toISOString(), decidedAt: null,
      decisionReason: null, daysPaidInDouble: 0,
    };
    vacations.push(created);
    return clone(created);
  },
  approve: async (id) => {
    await delay();
    return decide(id, 'aprovada');
  },
  reject: async (id, body) => {
    await delay();
    return decide(id, 'recusada', body.reason);
  },
  cancel: async (id, body) => {
    await delay();
    return decide(id, 'cancelada', body.reason);
  },
  calendar: async (q) => {
    await delay();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month)) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'month', message: 'use AAAA-MM' }]);
    const first = `${q.month}-01`;
    const last = addDays(`${addMonthKey(q.month)}-01`, -1);
    const days = Number(last.slice(8, 10));
    const sectors = q.establishmentId === '1' ? SECTORS.filter((s) => !q.departmentId || s.departmentId === q.departmentId) : [];
    const departments = sectors.map((s) => {
      const rows = vacations
        .filter((v) => v.departmentId === s.departmentId && overlaps(v.startDate, v.endDate, first, last))
        .sort((a, b) => (a.startDate === b.startDate ? Number(a.id) - Number(b.id) : a.startDate < b.startDate ? -1 : 1))
        .map(toRow);
      return {
        departmentId: s.departmentId, name: s.name, headcount: s.headcount, maxSimultaneous: s.maxSimultaneous,
        dailyOccupancy: Array.from({ length: days }, (_, i) => occupancyOn(s.departmentId, `${q.month}-${String(i + 1).padStart(2, '0')}`)),
        rows,
      };
    });
    const result: VacationCalendar = { month: q.month, departments };
    return clone(result);
  },
};

const addMonthKey = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
