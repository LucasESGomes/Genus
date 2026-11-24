import { describe, expect, it } from 'vitest';
import { timeBankParams } from '../../../../test/support/rh-legal-fixtures';
import {
  assertDebitAllowed,
  creditDueDate,
  creditsExpiringWithin,
  negativeBalanceToDiscount,
  openCredits,
  parseWeightHundredths,
  settleExpiredCredits,
  timeBankBalance,
  weightedCreditMinutes,
  type TimeBankEntry,
} from './ledger';

const e = (id: string, type: TimeBankEntry['type'], minutes: number, competenceDate: string, dueDate: string | null = null): TimeBankEntry => ({
  id,
  type,
  minutes,
  competenceDate,
  dueDate,
});

describe('banco de horas (RN09)', () => {
  it('saldo é a soma dos lançamentos', () => {
    expect(timeBankBalance([e('1', 'credito', 120, '2026-01-10'), e('2', 'debito', -30, '2026-01-11')])).toBe(90);
  });

  it('vencimento pela modalidade: 6 meses individual, 12 coletivo', () => {
    expect(creditDueDate('2026-01-10', 'individual_6m', timeBankParams())).toBe('2026-07-10');
    expect(creditDueDate('2026-01-10', 'coletivo_12m', timeBankParams())).toBe('2027-01-10');
    // fim de mês: 31/08 + 6 meses = 28/02
    expect(creditDueDate('2026-08-31', 'individual_6m', timeBankParams())).toBe('2027-02-28');
  });

  it('o prazo vem do parâmetro', () => {
    expect(creditDueDate('2026-01-10', 'individual_6m', timeBankParams({ banco_prazo_meses_individual: 3 }))).toBe('2026-04-10');
  });

  it('peso de domingo e feriado sem float (RF34)', () => {
    expect(parseWeightHundredths('1.50')).toBe(150);
    expect(weightedCreditMinutes(61, 150)).toBe(92); // 91,5 → 92 [A CONFIRMAR arredondamento]
    expect(() => parseWeightHundredths('1.5')).toThrow(expect.objectContaining({ code: 'PARAMETRO_INVALIDO' }));
  });

  it('débito consome o crédito que vence primeiro (FIFO)', () => {
    const entries = [
      e('b', 'credito', 60, '2026-02-01', '2026-08-01'),
      e('a', 'credito', 60, '2026-01-01', '2026-07-01'),
      e('d', 'folga_compensatoria', -90, '2026-03-01'),
    ];
    expect(openCredits(entries)).toEqual([{ entryId: 'b', competenceDate: '2026-02-01', dueDate: '2026-08-01', remainingMinutes: 30 }]);
  });

  it('crédito vencido vira pagamento de extra, uma vez só', () => {
    const entries = [e('a', 'credito', 100, '2026-01-01', '2026-07-01'), e('d', 'debito', -40, '2026-02-01')];
    const proposed = settleExpiredCredits(entries, '2026-07-01');
    expect(proposed).toEqual([{ type: 'pagamento', minutes: -60, competenceDate: '2026-07-01', sourceEntryId: 'a' }]);
    const after = [...entries, e('p', 'pagamento', -60, '2026-07-01')];
    expect(settleExpiredCredits(after, '2026-07-02')).toEqual([]);
    expect(settleExpiredCredits(entries, '2026-06-30')).toEqual([]);
  });

  it('alerta de crédito vencendo em N dias', () => {
    const entries = [e('a', 'credito', 60, '2026-01-01', '2026-07-01'), e('b', 'credito', 60, '2026-03-01', '2026-09-01')];
    expect(creditsExpiringWithin(entries, '2026-06-01', 30).map((c) => c.entryId)).toEqual(['a']);
  });

  it('limite de saldo negativo para débito manual', () => {
    const entries = [e('d', 'debito', -500, '2026-01-01')];
    expect(() => assertDebitAllowed(entries, 100, timeBankParams(), '2026-02-01')).not.toThrow();
    expect(() => assertDebitAllowed(entries, 101, timeBankParams(), '2026-02-01')).toThrow(
      expect.objectContaining({ code: 'BANCO_SALDO_NEGATIVO_EXCEDIDO' }),
    );
  });

  it('desconto de saldo negativo só com o parâmetro ligado', () => {
    const entries = [e('d', 'debito', -90, '2026-01-01')];
    expect(negativeBalanceToDiscount(entries, timeBankParams(), '2026-07-01')).toBe(0);
    expect(negativeBalanceToDiscount(entries, timeBankParams({ banco_desconto_saldo_negativo: true }), '2026-07-01')).toBe(90);
  });

  it.todo('lançamento de desconto que zera saldo negativo: o CHECK bh_sinal_coerente exige minutos < 0 para todo tipo que não é crédito');
  it.todo('liquidação no desligamento (RF38): fora desta etapa');
});
