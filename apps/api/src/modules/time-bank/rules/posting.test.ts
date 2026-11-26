import { describe, expect, it } from 'vitest';
import { openCredits, timeBankSummary, type TimeBankEntry } from './ledger';
import { currentOrNextPolicy, planPolicyChange, type PolicyPeriod } from './policy-validity';
import { dayTargetMinutes, type PostingDay } from './posting';

const WEDNESDAY = '2026-11-18';
const SUNDAY = '2026-11-22';
const weights = { sundayWeight: '1.50', holidayWeight: '2.00' };

const day = (over: Partial<PostingDay> = {}): PostingDay => ({
  workDate: WEDNESDAY,
  situation: 'normal',
  status: 'calculada',
  overtime50Minutes: 0,
  overtime100Minutes: 0,
  shortfallMinutes: 0,
  holidayTreatment: null,
  ...over,
});

describe('alvo do dia no banco de horas', () => {
  it.each<[string, Partial<PostingDay>, number]>([
    ['jornada exata', {}, 0],
    ['extra em dia útil, sem peso', { overtime50Minutes: 60 }, 60],
    ['extra a 50% em domingo de trabalho, sem peso', { workDate: SUNDAY, overtime50Minutes: 60 }, 60],
    ['atraso ou saída antecipada debita', { shortfallMinutes: 25 }, -25],
    ['falta integral não debita', { situation: 'falta' }, 0],
    ['folga de domingo com peso de domingo', { workDate: SUNDAY, situation: 'folga', overtime100Minutes: 61 }, 92],
    ['folga fora do domingo vale 1,00', { situation: 'folga', overtime100Minutes: 120 }, 120],
    ['feriado com peso de feriado', { situation: 'feriado', overtime100Minutes: 60, holidayTreatment: 'banco_horas' }, 120],
    ['feriado no domingo: vale o peso de feriado', { workDate: SUNDAY, situation: 'feriado', overtime100Minutes: 60 }, 120],
    ['feriado com pagar_100 vai para a folha', { situation: 'feriado', overtime100Minutes: 60, holidayTreatment: 'pagar_100' }, 0],
    ['dia inconsistente', { status: 'inconsistente', overtime50Minutes: 60, shortfallMinutes: 30 }, 0],
    ['férias', { situation: 'ferias', overtime100Minutes: 60 }, 0],
    ['afastamento', { situation: 'afastamento', overtime50Minutes: 60 }, 0],
  ])('%s', (_name, over, expected) => {
    expect(dayTargetMinutes(day(over), weights)).toBe(expected);
  });
});

const entry = (id: string, minutes: number, competenceDate: string, dueDate: string | null, dailyTimesheetId: string | null): TimeBankEntry => ({
  id,
  type: minutes > 0 ? 'credito' : 'debito',
  minutes,
  competenceDate,
  dueDate,
  dailyTimesheetId,
});

describe('FIFO com estorno do dia', () => {
  it('o estorno de um dia não consome o crédito de outro', () => {
    const entries = [
      entry('1', 60, '2026-05-01', '2026-12-01', '10'),
      entry('2', 90, '2026-06-01', '2027-01-01', '11'),
      entry('3', -90, '2026-06-01', null, '11'),
    ];
    expect(openCredits(entries)).toEqual([{ entryId: '1', competenceDate: '2026-05-01', dueDate: '2026-12-01', remainingMinutes: 60 }]);
  });

  it('correção de débito não cria crédito; saldo positivo do dia usa o vencimento mais próximo', () => {
    expect(openCredits([entry('1', -60, '2026-06-01', null, '10'), entry('2', 60, '2026-06-01', '2026-12-01', '10')])).toEqual([]);
    const grown = [entry('1', 60, '2026-06-01', '2026-12-01', '10'), entry('2', 30, '2026-06-01', '2027-06-01', '10')];
    expect(openCredits(grown)).toEqual([{ entryId: '1', competenceDate: '2026-06-01', dueDate: '2026-12-01', remainingMinutes: 90 }]);
  });

  it('resumo: saldo, a vencer em 30 dias e próximo vencimento depois de hoje', () => {
    const entries = [
      entry('1', 60, '2026-05-20', '2026-11-20', '1'), // já vencido
      entry('2', 120, '2026-06-10', '2026-12-10', '2'),
      entry('3', 30, '2026-07-01', '2027-01-01', '3'),
      entry('4', -90, '2026-08-01', null, '4'),
    ];
    // o débito consome o vencido (60) e 30 do que vence em 10/12
    expect(timeBankSummary(entries, '2026-11-25')).toEqual({ balanceMinutes: 120, expiringIn30DaysMinutes: 90, nextDueDate: '2026-12-10' });
    expect(timeBankSummary([], '2026-11-25')).toEqual({ balanceMinutes: 0, expiringIn30DaysMinutes: 0, nextDueDate: null });
  });
});

const period = (id: number, validFrom: string, validTo: string | null = null): PolicyPeriod => ({ id, validFrom, validTo });

describe('vigência da regra', () => {
  const today = '2026-11-25';
  const past = period(1, '2026-01-01', '2026-05-31');
  const current = period(2, '2026-06-01', '2026-12-31');
  const next = period(3, '2027-01-01');

  it('vale a de hoje ou a próxima', () => {
    expect(currentOrNextPolicy([next, past, current], today)?.id).toBe(2);
    expect(currentOrNextPolicy([past, next], today)?.id).toBe(3);
    expect(currentOrNextPolicy([past], today)).toBeNull();
  });

  it.each<[string, PolicyPeriod[], string, ReturnType<typeof planPolicyChange>]>([
    ['primeira regra', [], '2026-01-01', { kind: 'insert', closePrevious: null, validTo: null }],
    ['mesmo início atualiza', [past, current], '2026-06-01', { kind: 'update', id: 2 }],
    ['início da próxima atualiza a próxima', [current, next], '2027-01-01', { kind: 'update', id: 3 }],
    ['anterior à vigente', [past, current], '2026-05-01', { kind: 'conflict' }],
    ['posterior encerra a vigente na véspera', [period(2, '2026-06-01')], '2026-12-01', { kind: 'insert', closePrevious: { id: 2, validTo: '2026-11-30' }, validTo: null }],
    ['entre a vigente e a agendada', [current, next], '2026-12-01', { kind: 'insert', closePrevious: { id: 2, validTo: '2026-11-30' }, validTo: '2026-12-31' }],
    ['depois de uma encerrada, sem sobrepor', [past], '2026-08-01', { kind: 'insert', closePrevious: null, validTo: null }],
    ['sobre uma encerrada, sem vigente', [past], '2026-03-01', { kind: 'insert', closePrevious: { id: 1, validTo: '2026-02-28' }, validTo: null }],
    ['antes de uma encerrada, sem vigente', [past], '2025-12-01', { kind: 'conflict' }],
  ])('%s', (_name, periods, validFrom, expected) => {
    expect(planPolicyChange(periods, validFrom, today)).toEqual(expected);
  });
});
