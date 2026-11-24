import { describe, expect, it } from 'vitest';
import { timesheetParams } from '../../../../test/support/rh-legal-fixtures';
import { computeDay, type DayInput, type Punch } from './day';

const D = '2026-11-23'; // segunda-feira

let nsr = 100;
function orig(time: string, date = D, extra: Partial<Punch> = {}): Punch {
  nsr += 1;
  return { at: `${date}T${time}`, origin: 'original', nsr, ...extra };
}

// Escala de fixture: 08:00–12:00 e 13:00–17:00 (480 min)
const commercial = ['08:00', '12:00', '13:00', '17:00'].map((t) => `${D}T${t}`);

function day(overrides: Partial<DayInput> = {}): DayInput {
  return {
    workDate: D,
    companyId: null,
    schedule: { kind: 'trabalho', expectedPunches: commercial },
    holiday: null,
    leave: null,
    compensatoryRestGranted: false,
    punches: ['08:00', '12:00', '13:00', '17:00'].map((t) => orig(t)),
    previousShiftEnd: null,
    nightWorkType: 'urbano',
    parameters: timesheetParams(),
    ...overrides,
  };
}

describe('computeDay: dia normal', () => {
  it('jornada exata', () => {
    const r = computeDay(day());
    expect(r).toMatchObject({
      situation: 'normal',
      status: 'calculada',
      expectedMinutes: 480,
      workedMinutes: 480,
      breakMinutes: 60,
      overtime50Minutes: 0,
      shortfallMinutes: 0,
      inconsistencies: [],
    });
    expect(r.parameterVersion).toContain('tolerancia_batida_min@');
  });

  it('dia de trabalho sem marcação é falta do previsto inteiro', () => {
    const r = computeDay(day({ punches: [] }));
    expect(r).toMatchObject({ situation: 'falta', absenceMinutes: 480, workedMinutes: 0, inconsistencies: [] });
  });
});

describe('computeDay: tolerância (RN02, CLT art. 58 §1º, Súmula 366)', () => {
  it('variação exatamente no limite por batida (5) e no limite do dia (10) é desconsiderada', () => {
    const punches = [orig('08:05'), orig('12:00'), orig('13:00'), orig('17:05')];
    const r = computeDay(day({ punches }));
    expect(r).toMatchObject({ lateMinutes: 0, overtime50Minutes: 0, shortfallMinutes: 0, toleranceApplied: true });
    expect(r.workedMinutes).toBe(480);
  });

  it('6 minutos numa batida contam por inteiro', () => {
    const punches = [orig('08:06'), orig('12:00'), orig('13:00'), orig('17:00')];
    const r = computeDay(day({ punches }));
    expect(r).toMatchObject({ lateMinutes: 6, shortfallMinutes: 6 });
  });

  it('soma do dia acima do limite (11) conta tudo, inclusive as variações pequenas', () => {
    // 4 + 5 = 9: dentro. Com mais 2 na volta do intervalo, 11 passa de 10.
    const punches = [orig('07:56'), orig('12:00'), orig('13:00'), orig('17:05')];
    const r1 = computeDay(day({ punches }));
    expect(r1).toMatchObject({ overtime50Minutes: 0, toleranceApplied: true });

    const over = [orig('07:56'), orig('12:00'), orig('12:58'), orig('17:05')];
    const r2 = computeDay(day({ punches: over }));
    expect(r2).toMatchObject({ overtime50Minutes: 11, toleranceApplied: false });
  });

  it('a tolerância vem do parâmetro, não do código', () => {
    const punches = [orig('08:06'), orig('12:00'), orig('13:00'), orig('17:00')];
    const r = computeDay(day({ punches, parameters: timesheetParams({ tolerancia_batida_min: 7 }) }));
    expect(r).toMatchObject({ lateMinutes: 0, shortfallMinutes: 0 });
  });
});

describe('computeDay: inconsistências de marcação', () => {
  it('número ímpar de batidas: inconsistente, sem cálculo', () => {
    const punches = [orig('08:00'), orig('12:00'), orig('13:00')];
    const r = computeDay(day({ punches }));
    expect(r).toMatchObject({ status: 'inconsistente', workedMinutes: 0, overtime50Minutes: 0 });
    expect(r.inconsistencies).toEqual(['marcacoes_impares']);
  });

  it('batida faltando (2 de 4): calcula e sinaliza marcação e intervalo ausentes', () => {
    const r = computeDay(day({ punches: [orig('08:00'), orig('17:00')] }));
    expect(r.status).toBe('calculada');
    expect(r.workedMinutes).toBe(540);
    expect(r.overtime50Minutes).toBe(60);
    expect(r.suppressedBreakMinutes).toBe(60);
    expect(r.inconsistencies).toEqual(['intervalo_ausente', 'marcacao_ausente']);
  });

  it('batida duplicada no mesmo minuto: inconsistente, sem cálculo', () => {
    const punches = [orig('08:00'), orig('08:00'), orig('12:00'), orig('13:00'), orig('17:00'), orig('17:00')];
    const r = computeDay(day({ punches }));
    expect(r.status).toBe('inconsistente');
    expect(r.inconsistencies).toContain('marcacao_duplicada');
  });

  it('fora de ordem (NSR menor com horário maior): sinaliza e calcula pela ordem do horário', () => {
    const punches: Punch[] = [
      { at: `${D}T12:00`, origin: 'original', nsr: 1 },
      { at: `${D}T08:00`, origin: 'original', nsr: 2 },
      { at: `${D}T13:00`, origin: 'original', nsr: 3 },
      { at: `${D}T17:00`, origin: 'original', nsr: 4 },
    ];
    const r = computeDay(day({ punches }));
    expect(r.inconsistencies).toEqual(['marcacao_fora_de_ordem']);
    expect(r.workedMinutes).toBe(480);
  });

  it('batida atrasada do modo offline (NSR atribuído depois) não é fora de ordem e dá o mesmo resultado (RNF05)', () => {
    const online = computeDay(day());
    const punches: Punch[] = [
      { at: `${D}T08:00`, origin: 'original', nsr: 50, collectedOffline: true },
      { at: `${D}T12:00`, origin: 'original', nsr: 10 },
      { at: `${D}T13:00`, origin: 'original', nsr: 11 },
      { at: `${D}T17:00`, origin: 'original', nsr: 12 },
    ];
    const offline = computeDay(day({ punches }));
    expect(offline.inconsistencies).toEqual([]);
    expect({ ...offline, parameterVersion: '' }).toEqual({ ...online, parameterVersion: '' });
  });

  it('marcação tratada (ajuste aprovado) entra sem NSR; original sem NSR é recusada', () => {
    const punches: Punch[] = [orig('08:00'), { at: `${D}T12:00`, origin: 'tratada', nsr: null }, orig('13:00'), orig('17:00')];
    expect(computeDay(day({ punches })).workedMinutes).toBe(480);
    const bad: Punch[] = [{ at: `${D}T08:00`, origin: 'original', nsr: null }, orig('12:00')];
    expect(() => computeDay(day({ punches: bad }))).toThrow(expect.objectContaining({ code: 'DATA_INVALIDA' }));
  });
});

describe('computeDay: intervalo (RN03, CLT art. 71)', () => {
  it('jornada acima de 6 h com 40 min de intervalo: insuficiente, 20 min suprimidos', () => {
    const punches = [orig('08:00'), orig('12:00'), orig('12:40'), orig('17:00')];
    const r = computeDay(day({ punches }));
    expect(r.inconsistencies).toContain('intervalo_insuficiente');
    expect(r.suppressedBreakMinutes).toBe(20);
  });

  it('jornada entre 4 h e 6 h exige 15 min', () => {
    const sched = { kind: 'trabalho' as const, expectedPunches: [`${D}T08:00`, `${D}T13:00`] };
    const r = computeDay(day({ schedule: sched, punches: [orig('08:00'), orig('13:00')] }));
    expect(r.inconsistencies).toEqual(['intervalo_ausente']);
    expect(r.suppressedBreakMinutes).toBe(15);
  });

  it('jornada de exatamente 4 h não exige intervalo', () => {
    const sched = { kind: 'trabalho' as const, expectedPunches: [`${D}T08:00`, `${D}T12:00`] };
    const r = computeDay(day({ schedule: sched, punches: [orig('08:00'), orig('12:00')] }));
    expect(r.inconsistencies).toEqual([]);
  });
});

describe('computeDay: interjornada (RN04, CLT art. 66)', () => {
  it('10 h 59 desde a última saída: sinaliza, sem bloquear', () => {
    const r = computeDay(day({ previousShiftEnd: '2026-11-22T21:01' }));
    expect(r.interjourneyMinutes).toBe(659);
    expect(r.inconsistencies).toEqual(['interjornada_insuficiente']);
    expect(r.workedMinutes).toBe(480);
  });

  it('exatamente 11 h: sem sinal', () => {
    const r = computeDay(day({ previousShiftEnd: '2026-11-22T21:00' }));
    expect(r.interjourneyMinutes).toBe(660);
    expect(r.inconsistencies).toEqual([]);
  });
});

describe('computeDay: extras (RN05)', () => {
  it('mais de 2 h extras: apura tudo e só sinaliza', () => {
    const punches = [orig('08:00'), orig('12:00'), orig('13:00'), orig('19:30')];
    const r = computeDay(day({ punches }));
    expect(r.overtime50Minutes).toBe(150);
    expect(r.inconsistencies).toEqual(['extras_acima_limite']);
  });

  it('folga trabalhada sem folga compensatória vai a 100%; com compensatória, 50%', () => {
    const base = { schedule: { kind: 'folga' as const }, punches: [orig('08:00'), orig('12:00')] };
    expect(computeDay(day(base))).toMatchObject({ situation: 'folga', overtime100Minutes: 240, overtime50Minutes: 0 });
    expect(computeDay(day({ ...base, compensatoryRestGranted: true }))).toMatchObject({ overtime100Minutes: 0, overtime50Minutes: 240 });
  });
});

describe('computeDay: feriado', () => {
  it('feriado em dia útil sem trabalho: sem previsto e sem falta', () => {
    const r = computeDay(day({ holiday: { worksOnHoliday: false, treatment: null }, punches: [] }));
    expect(r).toMatchObject({ situation: 'feriado', expectedMinutes: 0, absenceMinutes: 0, shortfallMinutes: 0 });
  });

  it('feriado em dia útil trabalhado: tudo a 100% e o tratamento segue para o banco', () => {
    const r = computeDay(day({ holiday: { worksOnHoliday: true, treatment: 'banco_horas' } }));
    expect(r).toMatchObject({ situation: 'feriado', overtime100Minutes: 480, overtime50Minutes: 0, holidayTreatment: 'banco_horas' });
  });
});

describe('computeDay: noturno (RN07)', () => {
  const N = '2026-11-23';
  const night = { kind: 'trabalho' as const, expectedPunches: [`${N}T22:00`, `2026-11-24T05:00`] };
  const nightPunches = () => [orig('22:00', N), orig('05:00', '2026-11-24')];

  it('urbano cruzando a meia-noite: 7 h de relógio viram 8 h com a hora reduzida', () => {
    const r = computeDay(day({ schedule: night, punches: nightPunches() }));
    expect(r).toMatchObject({ workedClockMinutes: 420, nightClockMinutes: 420, nightEquivalentMinutes: 480, workedMinutes: 480, expectedMinutes: 480, overtime50Minutes: 0 });
  });

  it('rural lavoura (21h–5h): sem hora reduzida', () => {
    const r = computeDay(day({ schedule: night, punches: nightPunches(), nightWorkType: 'rural_lavoura' }));
    expect(r).toMatchObject({ nightClockMinutes: 420, nightEquivalentMinutes: 420, workedMinutes: 420 });
  });

  it('rural pecuária (20h–4h): a última hora já é diurna', () => {
    const r = computeDay(day({ schedule: night, punches: nightPunches(), nightWorkType: 'rural_pecuaria' }));
    expect(r.nightClockMinutes).toBe(360);
  });

  it('turno 19h–23h urbano: só 1 h noturna', () => {
    const sched = { kind: 'trabalho' as const, expectedPunches: [`${N}T19:00`, `${N}T23:00`] };
    const r = computeDay(day({ schedule: sched, punches: [orig('19:00', N), orig('23:00', N)] }));
    expect(r.nightClockMinutes).toBe(60);
    expect(r.nightEquivalentMinutes).toBe(69); // 60 × 3600 / 3150 = 68,57 → 69 [A CONFIRMAR arredondamento]
  });

  it.todo('prorrogação da jornada noturna depois das 5h (Súmula 60, II, TST): fora da especificação');
});

describe('computeDay: férias e afastamento', () => {
  it('marcação em dia de férias: sinaliza fora da escala, sem extra presumida', () => {
    const r = computeDay(day({ leave: 'ferias' }));
    expect(r).toMatchObject({ situation: 'ferias', overtime50Minutes: 0, overtime100Minutes: 0 });
    expect(r.inconsistencies).toEqual(['marcacao_fora_da_escala']);
  });
});
