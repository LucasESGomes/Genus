/**
 * Apuração do dia (G4, RF18 a RF22): função pura, determinística (RNF05).
 *
 * Lê marcações e acrescenta informação; nunca altera a marcação (RN01). Nada é
 * bloqueado: atraso, interjornada curta ou extra acima do limite só sinalizam
 * (art. 74). Marcação ímpar ou duplicada deixa o dia `inconsistente`, sem
 * cálculo, até o RH tratar (G5); nunca há cálculo silencioso.
 *
 * Quem chama resolve a escala do dia (escala_dia + troca_turno, inclusive
 * `vira_dia`) em instantes locais, converte as marcações para a hora local do
 * estabelecimento e passa a última saída da jornada anterior.
 */
import { ParameterReader, type LegalParameterRow } from '../../legal-parameters/rules/resolve';
import { nightKeys, PARAM } from '../../legal-parameters/rules/keys';
import { localMinutes, type CivilDate, type LocalDateTime } from '../../rules-common/rules/civil-time';
import { RhDomainError } from '../../rules-common/rules/errors';
import {
  nightClockMinutes,
  nightEquivalentMinutes,
  type NightWindow,
  type NightWorkType,
  type Segment,
} from './night';

/** Valores de `apuracao_marcacao.origem`. */
export type PunchOrigin = 'original' | 'tratada';

export interface Punch {
  at: LocalDateTime;
  origin: PunchOrigin;
  /** Obrigatório na original (vem do arp); ausente na tratada (vem de ajuste). */
  nsr: number | null;
  /** Coletada sem internet e recebida depois: o NSR é atribuído na chegada. */
  collectedOffline?: boolean;
}

/** Valores de `apuracoes_dia.situacao`. */
export type DaySituation = 'normal' | 'falta' | 'folga' | 'feriado' | 'ferias' | 'afastamento';

/**
 * Códigos de `04` G4 (RF21) + `marcacao_fora_de_ordem`, pedido nesta etapa e
 * ainda fora do `04`. O CHECK `inconsistencia_tipo` usa outros nomes; a tradução
 * fica em `timesheets/issue-codes.ts` (e a migration 0009 acrescentou os três que faltavam).
 */
export type InconsistencyCode =
  | 'marcacoes_impares'
  | 'marcacao_ausente'
  | 'marcacao_duplicada'
  | 'marcacao_fora_de_ordem'
  | 'marcacao_fora_da_escala'
  | 'intervalo_ausente'
  | 'intervalo_insuficiente'
  | 'interjornada_insuficiente'
  | 'extras_acima_limite';

export type DaySchedule =
  | { kind: 'trabalho'; expectedPunches: readonly LocalDateTime[] }
  | { kind: 'folga' };

/** Valores de `estabelecimento_feriado.tratamento`. */
export type HolidayTreatment = 'pagar_100' | 'banco_horas';

export interface DayInput {
  workDate: CivilDate;
  companyId: string | null;
  schedule: DaySchedule;
  /** Feriado do dia para o estabelecimento (feriado + estabelecimento_feriado). */
  holiday: { worksOnHoliday: boolean; treatment: HolidayTreatment | null } | null;
  /** Férias ou afastamento aprovado cobrindo o dia. */
  leave: 'ferias' | 'afastamento' | null;
  /** Domingo ou feriado trabalhado com folga compensatória (RN05): não vai a 100%. */
  compensatoryRestGranted: boolean;
  punches: readonly Punch[];
  previousShiftEnd: LocalDateTime | null;
  nightWorkType: NightWorkType;
  parameters: readonly LegalParameterRow[];
}

export interface DayResult {
  workDate: CivilDate;
  situation: DaySituation;
  status: 'calculada' | 'inconsistente';
  expectedMinutes: number;
  /** Relógio, sem a hora noturna reduzida. */
  workedClockMinutes: number;
  /** Com a hora noturna reduzida aplicada à parte noturna. */
  workedMinutes: number;
  breakMinutes: number;
  /** Intervalo mínimo não concedido (RN03). */
  suppressedBreakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  /** Diferença a menor contra o previsto, depois da tolerância. */
  shortfallMinutes: number;
  /** Dia de trabalho sem nenhuma marcação. */
  absenceMinutes: number;
  overtime50Minutes: number;
  overtime100Minutes: number;
  nightClockMinutes: number;
  nightEquivalentMinutes: number;
  /** Minutos desde a última saída da jornada anterior; null sem referência. */
  interjourneyMinutes: number | null;
  toleranceApplied: boolean;
  holidayTreatment: HolidayTreatment | null;
  inconsistencies: InconsistencyCode[];
  /** Linhas de parametros_legais usadas (RNF06). */
  parameterVersion: string;
}

interface Params {
  tolerancePerPunch: number;
  tolerancePerDay: number;
  longBreakAbove: number;
  longBreakMin: number;
  shortBreakAbove: number;
  shortBreakMin: number;
  interjourneyMin: number;
  overtimeMax: number;
  night: NightWindow;
}

function readParams(reader: ParameterReader, type: NightWorkType): Params {
  const keys = nightKeys(type);
  return {
    tolerancePerPunch: reader.int(PARAM.tolerancePerPunch),
    tolerancePerDay: reader.int(PARAM.tolerancePerDay),
    longBreakAbove: reader.int(PARAM.longBreakAboveWorkMinutes),
    longBreakMin: reader.int(PARAM.longBreakMinMinutes),
    shortBreakAbove: reader.int(PARAM.shortBreakAboveWorkMinutes),
    shortBreakMin: reader.int(PARAM.shortBreakMinMinutes),
    interjourneyMin: reader.int(PARAM.interjourneyMinMinutes),
    overtimeMax: reader.int(PARAM.dailyOvertimeMaxMinutes),
    night: {
      startMinute: reader.timeOfDay(keys.start),
      endMinute: reader.timeOfDay(keys.end),
      hourSeconds: reader.int(keys.hourSeconds),
    },
  };
}

function validatePunch(p: Punch): void {
  const ok = p.origin === 'original' ? p.nsr !== null : p.nsr === null;
  if (!ok) {
    // marcacao_procedencia do schema: original tem NSR; tratada não.
    throw new RhDomainError('DATA_INVALIDA', 'Marcação original exige NSR; marcação tratada não tem NSR', {
      origin: p.origin,
    });
  }
}

function pairSegments(times: readonly number[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < times.length; i += 2) {
    segments.push({ start: times[i] as number, end: times[i + 1] as number });
  }
  return segments;
}

function legalMinutes(segments: readonly Segment[], night: NightWindow) {
  let clock = 0;
  let nightClock = 0;
  for (const s of segments) {
    clock += s.end - s.start;
    nightClock += nightClockMinutes(s, night);
  }
  const nightEq = nightEquivalentMinutes(nightClock, night);
  return { clock, nightClock, nightEq, legal: clock - nightClock + nightEq };
}

/**
 * Original fora de ordem: em ordem de NSR, o horário precisa crescer. Batida
 * offline fica de fora, porque recebe NSR na chegada, depois de batidas mais
 * novas [A CONFIRMAR]. Tratada não tem NSR.
 */
function hasOutOfOrder(punches: readonly Punch[]): boolean {
  const online = punches
    .filter((p) => p.origin === 'original' && !p.collectedOffline)
    .map((p) => ({ nsr: p.nsr as number, at: localMinutes(p.at) }))
    .sort((a, b) => a.nsr - b.nsr);
  return online.some((p, i) => i > 0 && p.at < (online[i - 1] as { at: number }).at);
}

/**
 * Tolerância (RN02, CLT art. 58 §1º, Súmula 366): a variação de cada marcação
 * contra o previsto até `tolerancia_batida_min` é desconsiderada; se a soma das
 * variações passar de `tolerancia_dia_min`, conta tudo. Devolve quanto do
 * trabalhado foi desconsiderado e os atrasos e saídas antecipadas que restam.
 */
function applyTolerance(actual: readonly number[], expected: readonly number[], p: Params) {
  const diffs = actual.map((a, i) => a - (expected[i] as number));
  const totalAbs = diffs.reduce((s, d) => s + Math.abs(d), 0);
  const countAll = totalAbs > p.tolerancePerDay;
  let ignoredContribution = 0;
  let late = 0;
  let early = 0;
  let anyIgnored = false;
  diffs.forEach((d, i) => {
    const isEntry = i % 2 === 0;
    // entrada mais tarde tira trabalho; saída mais tarde soma
    const contribution = isEntry ? -d : d;
    if (!countAll && Math.abs(d) <= p.tolerancePerPunch) {
      ignoredContribution += contribution;
      if (d !== 0) anyIgnored = true;
      return;
    }
    if (isEntry && d > 0) late += d;
    if (!isEntry && d < 0) early += -d;
  });
  return { ignoredContribution, late, early, applied: anyIgnored };
}

export function computeDay(input: DayInput): DayResult {
  const reader = new ParameterReader(input.parameters, input.workDate, { companyId: input.companyId });
  const p = readParams(reader, input.nightWorkType);

  input.punches.forEach(validatePunch);
  const times = input.punches.map((x) => localMinutes(x.at)).sort((a, b) => a - b);
  const inconsistencies = new Set<InconsistencyCode>();

  if (times.some((t, i) => i > 0 && t === times[i - 1])) inconsistencies.add('marcacao_duplicada');
  if (hasOutOfOrder(input.punches)) inconsistencies.add('marcacao_fora_de_ordem');
  if (times.length % 2 === 1) inconsistencies.add('marcacoes_impares');

  const isWorkSchedule = input.schedule.kind === 'trabalho';
  const expectedTimes =
    input.schedule.kind === 'trabalho' ? input.schedule.expectedPunches.map(localMinutes) : [];
  const expectedLegal = legalMinutes(pairSegments(expectedTimes), p.night).legal;

  // Situação do dia e o que se espera dele
  let situation: DaySituation;
  let expectedMinutes = 0;
  let restDayWork = false;
  if (input.leave) {
    situation = input.leave;
  } else if (input.holiday) {
    // Feriado é descanso remunerado (Lei 605/1949): nada previsto, sem falta.
    // Se o estabelecimento trabalha, o que for trabalhado é extra; o destino
    // (pagar a 100% ou banco) sai em `holidayTreatment` para o G8 [A CONFIRMAR].
    situation = 'feriado';
    restDayWork = true;
  } else if (!isWorkSchedule) {
    situation = 'folga';
    restDayWork = true;
  } else {
    situation = times.length === 0 ? 'falta' : 'normal';
    expectedMinutes = expectedLegal;
  }

  const base: DayResult = {
    workDate: input.workDate,
    situation,
    status: 'calculada',
    expectedMinutes,
    workedClockMinutes: 0,
    workedMinutes: 0,
    breakMinutes: 0,
    suppressedBreakMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    shortfallMinutes: 0,
    absenceMinutes: situation === 'falta' ? expectedMinutes : 0,
    overtime50Minutes: 0,
    overtime100Minutes: 0,
    nightClockMinutes: 0,
    nightEquivalentMinutes: 0,
    interjourneyMinutes: null,
    toleranceApplied: false,
    holidayTreatment: input.holiday?.treatment ?? null,
    inconsistencies: [],
    parameterVersion: reader.version(),
  };

  const finish = (r: DayResult): DayResult => ({ ...r, inconsistencies: [...inconsistencies].sort() });

  if (inconsistencies.has('marcacoes_impares') || inconsistencies.has('marcacao_duplicada')) {
    return finish({ ...base, status: 'inconsistente' });
  }
  if (times.length === 0) return finish(base);

  const first = times[0] as number;
  const segments = pairSegments(times);
  const worked = legalMinutes(segments, p.night);
  const gaps = segments.slice(1).map((s, i) => s.start - (segments[i] as Segment).end);
  const r: DayResult = {
    ...base,
    workedClockMinutes: worked.clock,
    workedMinutes: worked.legal,
    breakMinutes: gaps.reduce((s, g) => s + g, 0),
    nightClockMinutes: worked.nightClock,
    nightEquivalentMinutes: worked.nightEq,
  };

  // Interjornada (RN04, CLT art. 66)
  if (input.previousShiftEnd !== null) {
    r.interjourneyMinutes = first - localMinutes(input.previousShiftEnd);
    if (r.interjourneyMinutes < p.interjourneyMin) inconsistencies.add('interjornada_insuficiente');
  }

  // Intervalo intrajornada (RN03, CLT art. 71): pela duração efetiva e pelo
  // maior intervalo do dia [A CONFIRMAR]
  const required =
    worked.clock > p.longBreakAbove ? p.longBreakMin : worked.clock > p.shortBreakAbove ? p.shortBreakMin : 0;
  if (required > 0) {
    const longest = gaps.length > 0 ? Math.max(...gaps) : 0;
    if (gaps.length === 0) inconsistencies.add('intervalo_ausente');
    else if (longest < required) inconsistencies.add('intervalo_insuficiente');
    r.suppressedBreakMinutes = Math.max(0, required - longest);
  }

  if (situation === 'ferias' || situation === 'afastamento') {
    // Trabalho registrado em dia coberto: o RH decide; nenhuma extra é presumida.
    inconsistencies.add('marcacao_fora_da_escala');
    return finish(r);
  }

  if (restDayWork) {
    // RN05: domingo ou feriado trabalhado sem folga compensatória vai a 100%.
    if (input.compensatoryRestGranted) r.overtime50Minutes = worked.legal;
    else r.overtime100Minutes = worked.legal;
  } else {
    let adjustedWorked = worked.legal;
    if (expectedTimes.length > 0 && expectedTimes.length === times.length) {
      const t = applyTolerance(times, expectedTimes, p);
      adjustedWorked -= t.ignoredContribution;
      r.lateMinutes = t.late;
      r.earlyLeaveMinutes = t.early;
      r.toleranceApplied = t.applied;
    } else if (times.length < expectedTimes.length) {
      inconsistencies.add('marcacao_ausente');
    }
    r.overtime50Minutes = Math.max(0, adjustedWorked - expectedMinutes);
    r.shortfallMinutes = Math.max(0, expectedMinutes - adjustedWorked);
  }

  // RN05: acima do limite diário só sinaliza; a extra é apurada normalmente.
  if (r.overtime50Minutes + r.overtime100Minutes > p.overtimeMax) inconsistencies.add('extras_acima_limite');

  return finish(r);
}
