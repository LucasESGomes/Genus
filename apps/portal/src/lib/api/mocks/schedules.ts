/**
 * Mock de schedules (dono: lote E). Mesmo contrato de endpoints/schedules.ts, estado em memória.
 * Erros no formato da api (mockFail): 404 fora do escopo, 400 VALIDATION_ERROR / REFERENCIA_INVALIDA,
 * 409 ESCALA_SOBREPOSTA. Os avisos (`warnings`) só avisam: nunca impedem salvar (RN06, art. 74).
 *
 * [A CONFIRMAR] O limite de 42 h com vigência em 16/12/2026 vem do alerta do design (visão geral), não de
 * norma verificada. Ele existe só aqui, nos dados do mock: a tela mostra o que a api devolve.
 */
import type { EmployeeSchedule, EntityId, Schedule, ScheduleDay, ScheduleOverride, ScheduleSummary, ScheduleDayInput, ScheduleWarning } from '../contracts';
import type { SchedulesApi } from '../endpoints/schedules';
import { MOCK_TODAY } from './employee-portal';
import { mockEmployeesApi } from './employees';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound } from './runtime';

const MOCK_LIMIT_MINUTES = 2520;
const MOCK_LIMIT_FROM = '2026-12-16';

const work = (position: number, startTime: string, endTime: string, breakStartTime: string | null = '12:00', breakEndTime: string | null = '13:00'): ScheduleDay => ({
  position, isDayOff: false, startTime, endTime, breakStartTime, breakEndTime, crossesMidnight: false,
});
const off = (position: number): ScheduleDay => ({
  position, isDayOff: true, startTime: null, endTime: null, breakStartTime: null, breakEndTime: null, crossesMidnight: false,
});

const weekOverLimit = (planned: number): ScheduleWarning => ({
  ruleValidFrom: MOCK_LIMIT_FROM, code: 'carga_semanal_acima_limite', plannedMinutes: planned, maxMinutes: MOCK_LIMIT_MINUTES,
});

const seedSchedules = (): Schedule[] => [
  {
    id: '1', establishmentId: '1', name: 'Campo 6x1 · 44 h', type: '6x1', cycleType: 'semanal', cycleDays: null, referenceDate: null, weeklyMinutes: 2640, isActive: true,
    days: [work(0, '07:00', '15:20', '11:00', '12:00'), work(1, '07:00', '15:20', '11:00', '12:00'), work(2, '07:00', '15:20', '11:00', '12:00'),
      work(3, '07:00', '15:20', '11:00', '12:00'), work(4, '07:00', '15:20', '11:00', '12:00'), work(5, '07:00', '15:20', '11:00', '12:00'), off(6)],
    warnings: [weekOverLimit(2640)],
  },
  {
    id: '2', establishmentId: '1', name: 'Administrativo 5x2 · 44 h', type: '5x2', cycleType: 'semanal', cycleDays: null, referenceDate: null, weeklyMinutes: 2640, isActive: true,
    days: [work(0, '08:00', '17:48'), work(1, '08:00', '17:48'), work(2, '08:00', '17:48'), work(3, '08:00', '17:48'), work(4, '08:00', '17:48'), off(5), off(6)],
    warnings: [weekOverLimit(2640)],
  },
  {
    id: '3', establishmentId: '1', name: 'Ordenha 12x36', type: '12x36', cycleType: 'ciclico', cycleDays: 2, referenceDate: '2026-11-01', weeklyMinutes: 2520, isActive: true,
    days: [work(0, '19:00', '07:00', '00:00', '01:00'), off(1)].map((d) => (d.position === 0 ? { ...d, crossesMidnight: true } : d)),
    warnings: [],
  },
  {
    id: '4', establishmentId: '1', name: 'Plantão livre', type: 'livre', cycleType: 'semanal', cycleDays: null, referenceDate: null, weeklyMinutes: 2400, isActive: true,
    days: [work(0, '09:00', '17:00'), work(1, '09:00', '17:00'), work(2, '09:00', '17:00'), work(3, '09:00', '17:00'), work(4, '09:00', '17:00'), off(5), off(6)],
    warnings: [{ ruleValidFrom: MOCK_LIMIT_FROM, code: 'folgas_abaixo_minimo', restDays: 1, minRestDays: 2 }],
  },
  {
    id: '5', establishmentId: '2', name: 'Usina 5x2 · 40 h', type: '5x2', cycleType: 'semanal', cycleDays: null, referenceDate: null, weeklyMinutes: 2400, isActive: true,
    days: [work(0, '07:00', '15:00'), work(1, '07:00', '15:00'), work(2, '07:00', '15:00'), work(3, '07:00', '15:00'), work(4, '07:00', '15:00'), off(5), off(6)],
    warnings: [],
  },
];

interface EmpSchedule { id: string; employeeId: string; scheduleId: string; validFrom: string; validTo: string | null }

const seedEmployeeSchedules = (): EmpSchedule[] => [
  { id: 'e101', employeeId: '101', scheduleId: '1', validFrom: '2023-02-01', validTo: null },
  { id: 'e102', employeeId: '102', scheduleId: '1', validFrom: '2019-08-12', validTo: null },
  { id: 'e103', employeeId: '103', scheduleId: '3', validFrom: '2020-01-06', validTo: null },
  { id: 'e109', employeeId: '109', scheduleId: '2', validFrom: '2016-02-15', validTo: null },
];

let schedules: Schedule[] = seedSchedules();
let employeeSchedules: EmpSchedule[] = seedEmployeeSchedules();

/** Volta ao estado inicial (testes). */
export function resetMockSchedules() {
  schedules = seedSchedules();
  employeeSchedules = seedEmployeeSchedules();
  overrides = [];
}

const summary = (s: Schedule): ScheduleSummary => ({ id: s.id, establishmentId: s.establishmentId, name: s.name, type: s.type, cycleType: s.cycleType, cycleDays: s.cycleDays, referenceDate: s.referenceDate, weeklyMinutes: s.weeklyMinutes, isActive: s.isActive });
const withName = (e: EmpSchedule): EmployeeSchedule => ({ ...e, scheduleName: schedules.find((s) => s.id === e.scheduleId)?.name ?? '' });
let overrides: ScheduleOverride[] = [];
const addDaysCivil = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const find = (id: EntityId) => {
  const s = schedules.find((x) => x.id === id);
  if (!s) throw mockNotFound();
  return s;
};

const validation = (path: string, message: string) => mockFail(400, 'VALIDATION_ERROR', 'Requisição inválida', [{ path, message }]);

function toDays(days: ScheduleDayInput[]): ScheduleDay[] {
  return days.map((d) => ({
    position: d.position,
    isDayOff: d.isDayOff ?? false,
    startTime: d.isDayOff ? null : (d.startTime ?? null),
    endTime: d.isDayOff ? null : (d.endTime ?? null),
    breakStartTime: d.breakStartTime ?? null,
    breakEndTime: d.breakEndTime ?? null,
    crossesMidnight: d.crossesMidnight ?? false,
  }));
}

function checkDays(cycleType: string, cycleDays: number | null | undefined, days: ScheduleDayInput[]) {
  if (days.length < 1 || days.length > 60) throw validation('days', 'informe de 1 a 60 dias');
  const max = cycleType === 'ciclico' ? (cycleDays ?? 0) - 1 : 6;
  const positions = days.map((d) => d.position);
  if (new Set(positions).size !== positions.length) throw validation('days', 'posição repetida');
  if (positions.some((p) => p > max || p < 0)) throw validation('days', `posição deve ir de 0 a ${max}`);
  for (const d of days) {
    if (!d.isDayOff && (!d.startTime || !d.endTime)) throw validation('days', 'folga não tem horário; dia de trabalho tem entrada e saída');
    if (!!d.breakStartTime !== !!d.breakEndTime) throw validation('days', 'intervalo precisa de início e fim');
  }
}

/** Avisos do mock: só informam, nunca impedem salvar. */
function warningsFor(weeklyMinutes: number, days: ScheduleDay[]): ScheduleWarning[] {
  const out: ScheduleWarning[] = [];
  if (weeklyMinutes > MOCK_LIMIT_MINUTES) out.push(weekOverLimit(weeklyMinutes));
  const rest = days.filter((d) => d.isDayOff).length;
  if (days.length === 7 && rest < 2) out.push({ ruleValidFrom: MOCK_LIMIT_FROM, code: 'folgas_abaixo_minimo', restDays: rest, minRestDays: 2 });
  return out;
}

const overlaps = (a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }) =>
  a.validFrom <= (b.validTo ?? '9999-12-31') && b.validFrom <= (a.validTo ?? '9999-12-31');

export const mockSchedulesApi: SchedulesApi = {
  list: async (q) => {
    await delay();
    return clone(schedules
      .filter((s) => (!q.establishmentId || s.establishmentId === q.establishmentId) && matchesQuery(q.q, s.name))
      .filter((s) => !q.status || s.isActive === (q.status === 'ativa'))
      .map(summary));
  },
  get: async (id) => {
    await delay();
    return clone(find(id));
  },
  create: async (body) => {
    await delay();
    if (body.cycleType === 'semanal' && (body.cycleDays || body.referenceDate)) throw validation('cycleDays', 'escala semanal não tem ciclo nem data de referência');
    if (body.cycleType === 'ciclico' && (!body.cycleDays || !body.referenceDate)) throw validation('cycleDays', 'escala cíclica precisa de ciclo e data de referência');
    if (body.name.trim().length < 2) throw validation('name', 'nome muito curto');
    if (!['1', '2', '3'].includes(body.establishmentId)) throw mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'establishmentId', message: 'estabelecimento não encontrado' }]);
    checkDays(body.cycleType, body.cycleDays, body.days);
    const days = toDays(body.days);
    const s: Schedule = {
      id: mockId(),
      establishmentId: body.establishmentId,
      name: body.name.trim(),
      type: body.type,
      cycleType: body.cycleType,
      cycleDays: body.cycleType === 'ciclico' ? (body.cycleDays ?? null) : null,
      referenceDate: body.cycleType === 'ciclico' ? (body.referenceDate ?? null) : null,
      weeklyMinutes: body.weeklyMinutes,
      isActive: true,
      days,
      warnings: warningsFor(body.weeklyMinutes, days),
    };
    schedules = [...schedules, s];
    return clone(s);
  },
  update: async (id, body) => {
    await delay();
    const s = find(id);
    if (body.days) checkDays(s.cycleType, s.cycleDays, body.days);
    if (body.name !== undefined) s.name = body.name.trim();
    if (body.weeklyMinutes !== undefined) s.weeklyMinutes = body.weeklyMinutes;
    if (body.days) s.days = toDays(body.days);
    if (body.isActive !== undefined) s.isActive = body.isActive;
    s.warnings = warningsFor(s.weeklyMinutes, s.days);
    return clone(s);
  },
  employeeSchedules: async (employeeId) => {
    await delay();
    await mockEmployeesApi.get(employeeId);
    return clone(employeeSchedules.filter((e) => e.employeeId === employeeId).sort((a, b) => a.validFrom.localeCompare(b.validFrom)).map(withName));
  },
  assign: async (employeeId, body) => {
    await delay();
    const emp = await mockEmployeesApi.get(employeeId);
    const s = schedules.find((x) => x.id === body.scheduleId);
    if (!s || s.establishmentId !== emp.establishmentId) {
      throw mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'scheduleId', message: 'escala não encontrada no estabelecimento do colaborador' }]);
    }
    if (!s.isActive) throw mockFail(400, 'ESCALA_INATIVA', 'A escala está inativa: reative-a antes de atribuir');
    if (body.validTo && body.validTo < body.validFrom) throw validation('validTo', 'fim antes do início');
    const next = { validFrom: body.validFrom, validTo: body.validTo ?? null };
    if (employeeSchedules.some((e) => e.employeeId === employeeId && overlaps(e, next))) {
      throw mockFail(409, 'ESCALA_SOBREPOSTA', 'A escala se sobrepõe a outra escala do colaborador');
    }
    const row: EmpSchedule = { id: mockId(), employeeId, scheduleId: body.scheduleId, ...next };
    employeeSchedules = [...employeeSchedules, row];
    return clone(withName(row));
  },
  endAssignment: async (employeeId, assignmentId, validTo) => {
    await delay();
    const row = employeeSchedules.find((e) => e.employeeId === employeeId && e.id === assignmentId);
    if (!row) throw mockNotFound();
    if (validTo !== null && validTo < row.validFrom) throw validation('validTo', 'fim antes do início da escala');
    row.validTo = validTo;
    return clone(withName(row));
  },
  switchSchedule: async (employeeId, body) => {
    await delay();
    const emp = await mockEmployeesApi.get(employeeId);
    const s = schedules.find((x) => x.id === body.scheduleId);
    if (!s || s.establishmentId !== emp.establishmentId) {
      throw mockFail(400, 'REFERENCIA_INVALIDA', 'Referência inválida', [{ path: 'scheduleId', message: 'escala não encontrada no estabelecimento do colaborador' }]);
    }
    if (!s.isActive) throw mockFail(400, 'ESCALA_INATIVA', 'A escala está inativa: reative-a antes de atribuir');
    const mine = employeeSchedules.filter((e) => e.employeeId === employeeId);
    const current = mine.find((e) => e.validFrom <= body.validFrom && (e.validTo === null || body.validFrom <= e.validTo));
    if (current && current.validFrom === body.validFrom) {
      current.scheduleId = body.scheduleId;
      return clone(withName(current));
    }
    const nextStart = mine.filter((e) => e.validFrom > body.validFrom).map((e) => e.validFrom).sort()[0];
    const validTo = nextStart ? addDaysCivil(nextStart, -1) : (current?.validTo ?? null);
    if (current) current.validTo = addDaysCivil(body.validFrom, -1);
    const row: EmpSchedule = { id: mockId(), employeeId, scheduleId: body.scheduleId, validFrom: body.validFrom, validTo };
    employeeSchedules = [...employeeSchedules, row];
    return clone(withName(row));
  },
  members: async (scheduleId) => {
    await delay();
    find(scheduleId);
    const today = MOCK_TODAY;
    const rows = employeeSchedules.filter((e) => e.scheduleId === scheduleId && e.validFrom <= today && (e.validTo === null || today <= e.validTo));
    const out = [];
    for (const r of rows) {
      const emp = await mockEmployeesApi.get(r.employeeId).catch(() => null);
      if (emp) out.push({ employeeId: r.employeeId, name: emp.name, registration: emp.registrationNumber ?? null, assignmentId: r.id, validFrom: r.validFrom, validTo: r.validTo });
    }
    return clone(out.sort((a, b) => a.name.localeCompare(b.name)));
  },
  overrides: async (employeeId, from, to) => {
    await delay();
    return clone(overrides.filter((o) => o.employeeId === employeeId && o.date >= from && o.date <= to).sort((a, b) => b.date.localeCompare(a.date)));
  },
  createOverride: async (employeeId, body) => {
    await delay();
    await mockEmployeesApi.get(employeeId);
    if (overrides.some((o) => o.employeeId === employeeId && o.date === body.date)) throw mockFail(409, 'CONFLICT', 'Já existe uma troca de turno para o colaborador nesse dia');
    const row: ScheduleOverride = {
      id: mockId(), employeeId, date: body.date, isDayOff: body.isDayOff,
      startTime: body.isDayOff ? null : (body.startTime ?? null), endTime: body.isDayOff ? null : (body.endTime ?? null),
      reason: body.reason, createdAt: `${MOCK_TODAY}T12:00:00.000Z`,
    };
    overrides = [...overrides, row];
    return clone(row);
  },
  deleteOverride: async (employeeId, overrideId) => {
    await delay();
    if (!overrides.some((o) => o.employeeId === employeeId && o.id === overrideId)) throw mockNotFound();
    overrides = overrides.filter((o) => o.id !== overrideId);
  },
};
