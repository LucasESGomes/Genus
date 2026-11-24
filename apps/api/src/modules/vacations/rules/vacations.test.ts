import { describe, expect, it } from 'vitest';
import { vacationParams } from '../../../../test/support/rh-legal-fixtures';
import { vacationEntitlementDays } from './entitlement';
import { assertVacationRequest, daysPaidInDouble, validateVacationRequest, type VacationRequestInput } from './request';

describe('vacationEntitlementDays (RN10, CLT art. 130)', () => {
  it.each([
    [0, 30], [5, 30], [6, 24], [14, 24], [15, 18], [23, 18], [24, 12], [32, 12], [33, 0],
  ])('%i faltas = %i dias', (absences, days) => {
    expect(vacationEntitlementDays(absences, vacationParams(), '2026-11-21')).toBe(days);
  });

  it('as faixas vêm do parâmetro', () => {
    const custom = vacationParams({ ferias_faixas_faltas: [{ maxFaltas: 10, dias: 30 }, { maxFaltas: null, dias: 0 }] });
    expect(vacationEntitlementDays(8, custom, '2026-11-21')).toBe(30);
  });

  it('faltas inválidas e faixas incompletas falham', () => {
    expect(() => vacationEntitlementDays(-1, vacationParams(), '2026-11-21')).toThrow(expect.objectContaining({ code: 'DATA_INVALIDA' }));
    const gap = vacationParams({ ferias_faixas_faltas: [{ maxFaltas: 5, dias: 30 }] });
    expect(() => vacationEntitlementDays(6, gap, '2026-11-21')).toThrow(expect.objectContaining({ code: 'PARAMETRO_INVALIDO' }));
  });
});

// Segunda 11/01/2027 a sexta 22/01/2027 (12 dias). Folgas: sábados e domingos.
const weekends = ['2027-01-09', '2027-01-10', '2027-01-16', '2027-01-17', '2027-01-23', '2027-01-24', '2027-02-06', '2027-02-07', '2027-03-06', '2027-03-07'];

function req(overrides: Partial<VacationRequestInput> = {}): VacationRequestInput {
  return {
    request: { start: '2027-01-11', end: '2027-01-22', cashAllowanceDays: 0 },
    noticeDate: '2026-12-01',
    entitlementDays: 30,
    sameAcquisitivePeriods: [],
    ownApprovedPeriods: [],
    sector: { limit: 1, othersApproved: [] },
    holidays: [],
    restDays: weekends,
    companyId: null,
    parameters: vacationParams(),
    ...overrides,
  };
}

const codes = (i: VacationRequestInput) => validateVacationRequest(i).map((e) => e.code);

describe('validateVacationRequest', () => {
  it('pedido válido', () => {
    expect(codes(req())).toEqual([]);
  });

  it('segundo pedido sobreposto no setor de limite 1: FERIAS_SETOR_DESFALCADO', () => {
    const colleague = { start: '2027-01-20', end: '2027-02-03' };
    const input = req({ sector: { limit: 1, othersApproved: [colleague] } });
    expect(codes(input)).toEqual(['FERIAS_SETOR_DESFALCADO']);
    expect(() => assertVacationRequest(input)).toThrow(expect.objectContaining({ code: 'FERIAS_SETOR_DESFALCADO' }));
  });

  it('o setor com limite 2 aceita o segundo, mas não o terceiro', () => {
    const a = { start: '2027-01-11', end: '2027-01-22' };
    expect(codes(req({ sector: { limit: 2, othersApproved: [a] } }))).toEqual([]);
    expect(codes(req({ sector: { limit: 2, othersApproved: [a, a] } }))).toEqual(['FERIAS_SETOR_DESFALCADO']);
  });

  it('encostar no último dia do colega já é sobreposição; o dia seguinte não', () => {
    expect(codes(req({ sector: { limit: 1, othersApproved: [{ start: '2027-01-01', end: '2027-01-11' }] } }))).toEqual(['FERIAS_SETOR_DESFALCADO']);
    expect(codes(req({ sector: { limit: 1, othersApproved: [{ start: '2027-01-01', end: '2027-01-10' }] } }))).toEqual([]);
  });

  it('fracionamento inválido: três períodos de 10 sem nenhum de 14', () => {
    const others = [
      { start: '2027-02-08', end: '2027-02-17', cashAllowanceDays: 0 },
      { start: '2027-03-08', end: '2027-03-17', cashAllowanceDays: 0 },
    ];
    const input = req({ request: { start: '2027-01-11', end: '2027-01-20', cashAllowanceDays: 0 }, sameAcquisitivePeriods: others });
    expect(codes(input)).toEqual(['FERIAS_FRACIONAMENTO_INVALIDO']);
  });

  it('5 dias primeiro é aceito (o período de 14 é cobrado quando o saldo acaba)', () => {
    expect(codes(req({ request: { start: '2027-01-11', end: '2027-01-15', cashAllowanceDays: 0 } }))).toEqual([]);
  });

  it('quarto período e período abaixo de 5 dias', () => {
    const three = [1, 2, 3].map((m) => ({ start: `2027-0${m + 1}-08`, end: `2027-0${m + 1}-12`, cashAllowanceDays: 0 }));
    expect(codes(req({ request: { start: '2027-01-11', end: '2027-01-15', cashAllowanceDays: 0 }, sameAcquisitivePeriods: three }))).toContain('FERIAS_FRACIONAMENTO_INVALIDO');
    expect(codes(req({ request: { start: '2027-01-11', end: '2027-01-14', cashAllowanceDays: 0 } }))).toEqual(['FERIAS_PERIODO_CURTO']);
  });

  it('saldo do período aquisitivo', () => {
    expect(codes(req({ entitlementDays: 12, request: { start: '2027-01-11', end: '2027-01-23', cashAllowanceDays: 0 } }))).toContain('FERIAS_SALDO_INSUFICIENTE');
  });

  it('abono pecuniário até 1/3 do direito (CLT art. 143)', () => {
    expect(codes(req({ request: { start: '2027-01-11', end: '2027-01-30', cashAllowanceDays: 10 } }))).toEqual([]);
    expect(codes(req({ request: { start: '2027-01-11', end: '2027-01-29', cashAllowanceDays: 11 } }))).toEqual(['FERIAS_ABONO_ACIMA_LIMITE']);
    // 24 dias de direito: abono até 8
    expect(codes(req({ entitlementDays: 24, request: { start: '2027-01-11', end: '2027-01-25', cashAllowanceDays: 9 } }))).toEqual(['FERIAS_ABONO_ACIMA_LIMITE']);
  });

  it('início vedado: na quinta antes do sábado, no feriado e nos 2 dias antes dele (RN11, art. 134 §3º)', () => {
    expect(codes(req({ request: { start: '2027-01-14', end: '2027-01-28', cashAllowanceDays: 0 } }))).toEqual(['FERIAS_INICIO_VEDADO']);
    expect(codes(req({ holidays: ['2027-01-13'] }))).toEqual(['FERIAS_INICIO_VEDADO']);
    expect(codes(req({ holidays: ['2027-01-11'] }))).toEqual(['FERIAS_INICIO_VEDADO']);
    expect(codes(req({ holidays: ['2027-01-14'] }))).toEqual([]);
  });

  it('a folga vem da escala, não de sábado e domingo fixos', () => {
    // escala com folga na quarta 13/01: a segunda 11/01 fica vedada
    expect(codes(req({ restDays: ['2027-01-13'] }))).toEqual(['FERIAS_INICIO_VEDADO']);
  });

  it('aviso com 30 dias (RN11, art. 135)', () => {
    expect(codes(req({ noticeDate: '2026-12-12' }))).toEqual([]);
    expect(codes(req({ noticeDate: '2026-12-13' }))).toEqual(['FERIAS_AVISO_INSUFICIENTE']);
  });

  it('a mesma pessoa não tem dois períodos no mesmo dia', () => {
    expect(codes(req({ ownApprovedPeriods: [{ start: '2027-01-22', end: '2027-01-30' }] }))).toEqual(['FERIAS_SOBREPOSTAS']);
  });

  it('fim antes do início', () => {
    expect(codes(req({ request: { start: '2027-01-11', end: '2027-01-10', cashAllowanceDays: 0 } }))).toEqual(['FERIAS_PERIODO_INVALIDO']);
  });

  it('sem parâmetro vigente, falha', () => {
    expect(() => validateVacationRequest(req({ parameters: [] }))).toThrow(expect.objectContaining({ code: 'PARAMETRO_AUSENTE' }));
  });

  it.todo('menores de 18 e maiores de 50 não fracionam: o art. 134 §2º foi revogado pela Lei 13.467/2017 e a regra não está na especificação');
});

describe('daysPaidInDouble (RN12, CLT art. 137)', () => {
  it('só os dias depois do fim do concessivo', () => {
    expect(daysPaidInDouble({ start: '2027-01-01', end: '2027-01-30' }, '2027-01-30')).toBe(0);
    expect(daysPaidInDouble({ start: '2027-01-01', end: '2027-01-30' }, '2027-01-20')).toBe(10);
    expect(daysPaidInDouble({ start: '2027-02-01', end: '2027-02-10' }, '2027-01-20')).toBe(10);
  });
});
