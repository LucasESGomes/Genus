/**
 * Mock de timesheets (dono: lote C). Mesmo contrato de endpoints/timesheets.ts, com dados fictícios
 * convertidos de mocks/data/design.ts (APUR do dia 21/11/2026 e ESP do espelho do colaborador '102').
 *
 * Aqui o mock faz o papel do servidor: os minutos, o status e as inconsistências são decididos nele
 * e a tela só mostra. Esta aritmética NÃO existe no portal. Erros no formato da api (mockFail).
 */
import type { DayRow, DayRowPage, DayRowQuery, EntityId, IssueType, Punch, TimesheetDay, TimesheetIssue } from '../contracts';
import type { TimesheetsApi } from '../endpoints/timesheets';
import { designDayRows, designMirror } from './data/design';
import { absencesOf } from './absences';
import { clone, delay, matchesQuery, mockFail, mockNotFound, paginate } from './runtime';
import { departmentIdOf, SEED_EMPLOYEES, seedEmployee, type SeedEmployee } from './seed';

/** Último dia com apuração no mock (o "hoje" do design). */
export const MOCK_LAST_DAY = '2026-11-21';
const HOLIDAY = '2026-11-20';
const EXPECTED_MINUTES = 440;
const MAX_RANGE_DAYS = 93;

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const fromMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const civilUtc = (civil: string) => {
  const [y, m, d] = civil.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};
const weekdayOf = (civil: string) => new Date(civilUtc(civil)).getUTCDay();
const addDays = (civil: string, n: number) => new Date(civilUtc(civil) + n * 86_400_000).toISOString().slice(0, 10);

const instant = (date: string, hhmm: string) => `${date}T${hhmm}:00-03:00`;

/** `15:20*` = marcação tratada (acrescentada por ajuste aprovado; a original continua no arp). */
function buildPunches(date: string, times: readonly string[], nsrBase: number): Punch[] {
  return times.map((t, i) => {
    const treated = t.endsWith('*');
    return {
      sequence: i + 1,
      at: instant(date, t.replace('*', '')),
      origin: treated ? 'tratada' : 'original',
      nsr: treated ? null : nsrBase + i,
      adjustmentId: treated ? '9001' : null,
    };
  });
}

const issue = (type: IssueType, resolved = false): TimesheetIssue => ({ type, resolved });

interface Measured {
  worked: number;
  breakMinutes: number;
}
function measure(times: readonly string[]): Measured {
  const ms = times.map((t) => toMin(t.replace('*', '')));
  let worked = 0;
  let breakMinutes = 0;
  for (let i = 0; i + 1 < ms.length; i += 2) worked += (ms[i + 1] ?? 0) - (ms[i] ?? 0);
  for (let i = 1; i + 1 < ms.length; i += 2) breakMinutes += (ms[i + 1] ?? 0) - (ms[i] ?? 0);
  return { worked, breakMinutes };
}

const empty = (date: string, situation: string, expected: number): TimesheetDay => ({
  date, situation, status: 'calculada', scheduleId: '1', expectedMinutes: expected, workedMinutes: 0, absenceMinutes: 0, lateMinutes: 0,
  overtime50Minutes: 0, overtime100Minutes: 0, nightMinutes: 0, breakMinutes: 0, parameterVersion: '2026.11', calculatedAt: instant(date, '22:00'),
  punches: [], issues: [],
});

/** Dia com marcações. */
function worked(date: string, times: readonly string[], nsrBase: number): TimesheetDay {
  const { worked: w, breakMinutes } = measure(times);
  const odd = times.length % 2 === 1;
  const diff = w - EXPECTED_MINUTES;
  const issues: TimesheetIssue[] = [];
  if (odd) issues.push(issue('batidas_impares'));
  if (diff > 120) issues.push(issue('extra_acima_2h'));
  // Saída incluída por ajuste aprovado: a falta de batida ficou resolvida (a original não muda).
  if (times.some((t) => t.endsWith('*'))) issues.push(issue('batida_faltando', true));
  const first = toMin((times[0] ?? '00:00').replace('*', ''));
  const base = empty(date, 'normal', EXPECTED_MINUTES);
  return {
    ...base,
    status: issues.some((i) => !i.resolved) ? 'inconsistente' : 'calculada',
    workedMinutes: w,
    lateMinutes: first - 420 > 10 ? first - 420 : 0,
    overtime50Minutes: diff > 10 ? diff : 0,
    breakMinutes,
    punches: buildPunches(date, times, nsrBase),
    issues,
  };
}

/** Marcações genéricas, determinísticas por colaborador e dia. */
function genericTimes(employeeId: string, date: string): string[] {
  const n = Number(employeeId);
  const day = Number(date.slice(8, 10));
  const entry = 6 * 60 + 50 + ((n * 7 + day * 3) % 15);
  const exit = entry + EXPECTED_MINUTES + 60 + ((n + day) % 4) * 2;
  const times = [fromMin(entry), fromMin(entry + 240), fromMin(entry + 300), fromMin(exit)];
  return (n + day) % 9 === 0 ? times.slice(0, 3) : times;
}

const designMirrorTimes = (date: string): readonly string[] | undefined =>
  date.startsWith('2026-11-') ? (designMirror.marcacoesPorDia as Record<number, readonly string[]>)[Number(date.slice(8, 10))] : undefined;

/** Apuração de um dia de um colaborador; 'sem_escala' = antes da admissão (sem escala vigente). */
function buildDay(emp: SeedEmployee, date: string): TimesheetDay | 'sem_escala' {
  if (date < emp.admissionDate) return 'sem_escala';
  if (absencesOf(emp.id).some((a) => a.startDate <= date && date <= a.endDate)) return empty(date, 'afastamento', 0);
  if (weekdayOf(date) === 0) return empty(date, 'folga', 0);
  if (date === HOLIDAY) return empty(date, 'feriado', 0);
  const nsrBase = Number(emp.id) * 1000 + Number(date.slice(8, 10)) * 4;
  const times = emp.id === '102' ? (designMirrorTimes(date) ?? genericTimes(emp.id, date)) : genericTimes(emp.id, date);
  return worked(date, times, nsrBase);
}

function daysFor(employeeId: EntityId, from: string, to: string): { days: TimesheetDay[]; skipped: { date: string; reason: 'sem_escala' }[] } {
  const emp = seedEmployee(employeeId);
  if (!emp) throw mockNotFound();
  if (to < from) throw mockFail(422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'to', message: 'fim antes do início' }]);
  const days: TimesheetDay[] = [];
  const skipped: { date: string; reason: 'sem_escala' }[] = [];
  let date = from;
  for (let i = 0; i < MAX_RANGE_DAYS && date <= to && date <= MOCK_LAST_DAY; i++, date = addDays(date, 1)) {
    const d = buildDay(emp, date);
    if (d === 'sem_escala') skipped.push({ date, reason: 'sem_escala' });
    else days.push(d);
  }
  return { days, skipped };
}

// ---- apuração do dia de todos (design: APUR) ----

const motivoToIssues = (motivo: string): TimesheetIssue[] => {
  if (motivo.startsWith('Marcações ímpares')) return [issue('batidas_impares')];
  if (motivo.startsWith('Intervalo')) return [issue('intervalo_nao_cumprido')];
  if (motivo.startsWith('Extras acima')) return [issue('extra_acima_2h')];
  if (motivo.startsWith('Interjornada')) return [issue('interjornada_menor_11h')];
  return [];
};
const parseHm = (s: string) => (/^\d{2}:\d{2}$/.test(s) ? toMin(s) : 0);

function designRows(date: string): DayRow[] {
  return designDayRows.map((r) => {
    const emp = SEED_EMPLOYEES.find((e) => e.registrationNumber === r.mat);
    const issues = motivoToIssues(r.motivo);
    return {
      employeeId: emp?.id ?? '0',
      employeeName: r.nome,
      registrationNumber: r.mat,
      departmentName: r.setor,
      jobTitleName: r.cargo,
      date,
      // Mock: abonado (atestado em análise no design) vira afastamento para exibir a situação.
      situation: r.st === 'falta' ? 'falta' : r.st === 'folga' ? 'folga' : r.st === 'abonado' ? 'afastamento' : 'normal',
      status: r.st === 'inconsistente' ? 'inconsistente' : 'calculada',
      isAbsence: r.st === 'falta',
      punches: buildPunches(date, r.marc, Number(emp?.id ?? 0) * 1000),
      expectedMinutes: parseHm(r.prev),
      workedMinutes: parseHm(r.trab),
      overtimeMinutes: parseHm(r.extra),
      absenceMinutes: parseHm(r.falta),
      issues,
    };
  });
}

/** Conjunto reduzido e determinístico para os demais dias e estabelecimentos. */
function genericRows(date: string, establishmentId: string): DayRow[] {
  if (weekdayOf(date) === 0 || date === HOLIDAY || date > MOCK_LAST_DAY) return [];
  return SEED_EMPLOYEES.filter((e) => e.establishmentId === establishmentId && e.id !== '101' && date >= e.admissionDate)
    .slice(0, 6)
    .map((e) => {
      const n = Number(e.id) + Number(date.slice(8, 10));
      const base = {
        employeeId: e.id, employeeName: e.name, registrationNumber: e.registrationNumber, departmentName: e.departmentName,
        jobTitleName: e.jobTitleName, date,
      };
      if (n % 7 === 0) {
        return { ...base, situation: 'falta', status: 'calculada' as const, isAbsence: true, punches: [], expectedMinutes: EXPECTED_MINUTES, workedMinutes: 0, overtimeMinutes: 0, absenceMinutes: EXPECTED_MINUTES, issues: [] };
      }
      const d = worked(date, genericTimes(e.id, date), Number(e.id) * 1000);
      return {
        ...base, situation: 'normal', status: d.status, isAbsence: false, punches: d.punches, expectedMinutes: d.expectedMinutes, workedMinutes: d.workedMinutes,
        overtimeMinutes: d.overtime50Minutes + d.overtime100Minutes, absenceMinutes: 0, issues: d.issues,
      };
    });
}

const matchesText = (r: DayRow, q: string) => matchesQuery(q, r.employeeName, r.registrationNumber);

export const mockTimesheetsApi: TimesheetsApi = {
  byEmployee: async (employeeId, q) => {
    await delay();
    return clone(daysFor(employeeId, q.from, q.to).days);
  },
  recalculate: async (employeeId, body) => {
    await delay();
    return clone(daysFor(employeeId, body.from, body.to));
  },
  day: async (q: DayRowQuery): Promise<DayRowPage> => {
    await delay();
    const all = q.date === MOCK_LAST_DAY && q.establishmentId === '1' ? designRows(q.date) : genericRows(q.date, q.establishmentId);
    const scoped = all.filter(
      (r) => (!q.departmentId || departmentIdOf(r.departmentName ?? '') === q.departmentId) && (!q.q || matchesText(r, q.q)),
    );
    // As contagens das abas ignoram `status` (como a api faria).
    const counts = {
      todos: scoped.length,
      inconsistente: scoped.filter((r) => r.status === 'inconsistente').length,
      falta: scoped.filter((r) => r.isAbsence).length,
      calculada: scoped.filter((r) => r.status === 'calculada' && !r.isAbsence).length,
    };
    const filtered = scoped.filter((r) => {
      if (!q.status) return true;
      if (q.status === 'falta') return r.isAbsence;
      if (q.status === 'calculada') return r.status === 'calculada' && !r.isAbsence;
      return r.status === q.status;
    });
    return { ...clone(paginate(filtered, q)), counts };
  },
};
