/**
 * Banco de horas (G8, RF33 a RF38, RN09, CLT art. 59 §§2º e 5º).
 *
 * O saldo é a soma do ledger `banco_horas_lancamento`, nunca um campo editável.
 * Crédito positivo; todo o resto negativo (CHECK `bh_sinal_coerente`). Crédito
 * é consumido por ordem de vencimento (FIFO). O prazo de compensação por
 * modalidade (`regras_banco_horas.modalidade`), o limite de saldo negativo e a
 * permissão de desconto vêm de `parametros_legais`.
 */
import { PARAM } from '../../legal-parameters/rules/keys';
import { ParameterReader, type LegalParameterRow } from '../../legal-parameters/rules/resolve';
import { addDays, addMonths, divRoundHalfUp, type CivilDate } from '../../rules-common/rules/civil-time';
import { RhDomainError } from '../../rules-common/rules/errors';

/** Valores de `banco_horas_lancamento.tipo`. */
export type TimeBankEntryType =
  | 'credito'
  | 'debito'
  | 'folga_compensatoria'
  | 'pagamento'
  | 'desconto'
  | 'expiracao';

/** Valores de `regras_banco_horas.modalidade`. */
export type TimeBankModality = 'individual_6m' | 'coletivo_12m';

export interface TimeBankEntry {
  id: string;
  type: TimeBankEntryType;
  minutes: number;
  competenceDate: CivilDate;
  dueDate: CivilDate | null;
}

export function timeBankBalance(entries: readonly TimeBankEntry[]): number {
  return entries.reduce((s, e) => s + e.minutes, 0);
}

/** Vencimento do crédito: competência + prazo da modalidade vigente na competência. */
export function creditDueDate(
  competenceDate: CivilDate,
  modality: TimeBankModality,
  rows: readonly LegalParameterRow[],
  companyId: string | null = null,
): CivilDate {
  const reader = new ParameterReader(rows, competenceDate, { companyId });
  const months = reader.int(
    modality === 'individual_6m' ? PARAM.timeBankMonthsIndividual : PARAM.timeBankMonthsCollective,
  );
  return addMonths(competenceDate, months);
}

/**
 * Converte `peso_domingo`/`peso_feriado` (NUMERIC(3,2), ex.: "1.50") em
 * centésimos inteiros, sem passar por float.
 */
export function parseWeightHundredths(value: string): number {
  const m = /^(\d)\.(\d{2})$/.exec(value);
  if (!m) throw new RhDomainError('PARAMETRO_INVALIDO', `Peso inválido: ${value}`, { value });
  return Number(m[1]) * 100 + Number(m[2]);
}

/** Crédito ponderado de domingo ou feriado (RF34). Arredonda meio para cima [A CONFIRMAR]. */
export function weightedCreditMinutes(minutes: number, weightHundredths: number): number {
  return divRoundHalfUp(minutes * weightHundredths, 100);
}

export interface OpenCredit {
  entryId: string;
  competenceDate: CivilDate;
  dueDate: CivilDate | null;
  remainingMinutes: number;
}

/** Créditos com saldo, depois de consumir todos os débitos do mais antigo para o mais novo. */
export function openCredits(entries: readonly TimeBankEntry[]): OpenCredit[] {
  const credits = entries
    .filter((e) => e.minutes > 0)
    .sort((a, b) => {
      const da = a.dueDate ?? '9999-12-31';
      const db = b.dueDate ?? '9999-12-31';
      if (da !== db) return da < db ? -1 : 1;
      if (a.competenceDate !== b.competenceDate) return a.competenceDate < b.competenceDate ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  let toConsume = -entries.filter((e) => e.minutes < 0).reduce((s, e) => s + e.minutes, 0);
  const open: OpenCredit[] = [];
  for (const c of credits) {
    const used = Math.min(c.minutes, toConsume);
    toConsume -= used;
    if (c.minutes - used > 0) {
      open.push({
        entryId: c.id,
        competenceDate: c.competenceDate,
        dueDate: c.dueDate,
        remainingMinutes: c.minutes - used,
      });
    }
  }
  return open;
}

/** Crédito que vence em até `days` dias depois de `asOf` (alerta do `check-deadlines`). */
export function creditsExpiringWithin(
  entries: readonly TimeBankEntry[],
  asOf: CivilDate,
  days: number,
): OpenCredit[] {
  const limit = addDays(asOf, days);
  return openCredits(entries).filter((c) => c.dueDate !== null && c.dueDate > asOf && c.dueDate <= limit);
}

export interface ProposedEntry {
  type: TimeBankEntryType;
  minutes: number;
  competenceDate: CivilDate;
  /** Crédito que originou o lançamento; vira a `chave_origem` de idempotência. */
  sourceEntryId: string;
}

/**
 * RN09: crédito não compensado até o vencimento é pago como hora extra.
 * Gera um `pagamento` (negativo) por crédito vencido. Idempotente: depois de
 * gravado, o pagamento consome o crédito e rodar de novo não gera nada.
 */
export function settleExpiredCredits(entries: readonly TimeBankEntry[], asOf: CivilDate): ProposedEntry[] {
  return openCredits(entries)
    .filter((c) => c.dueDate !== null && c.dueDate <= asOf)
    .map((c): ProposedEntry => ({ type: 'pagamento', minutes: -c.remainingMinutes, competenceDate: asOf, sourceEntryId: c.entryId }));
}

/**
 * Débito pedido pelo RH ou por folga compensatória não pode levar o saldo abaixo
 * de `-banco_saldo_negativo_max_min`. Débito vindo da apuração nunca passa por
 * aqui: o sistema não bloqueia marcação nem apuração.
 */
export function assertDebitAllowed(
  entries: readonly TimeBankEntry[],
  debitMinutes: number,
  rows: readonly LegalParameterRow[],
  date: CivilDate,
  companyId: string | null = null,
): void {
  const reader = new ParameterReader(rows, date, { companyId });
  const maxNegative = reader.int(PARAM.timeBankNegativeMaxMinutes);
  const after = timeBankBalance(entries) - Math.abs(debitMinutes);
  if (after < -maxNegative) {
    throw new RhDomainError('BANCO_SALDO_NEGATIVO_EXCEDIDO', 'O débito deixa o banco de horas abaixo do limite negativo', {
      balanceAfter: after,
      limit: -maxNegative,
    });
  }
}

/**
 * Minutos de saldo negativo a descontar na folha, só se o acordo prevê
 * (`banco_desconto_saldo_negativo`, começa desligado no `04` G8) [A CONFIRMAR].
 * Não gera lançamento: zerar saldo negativo exigiria minutos positivos num tipo
 * diferente de `credito`, e o CHECK `bh_sinal_coerente` não deixa (pendência).
 */
export function negativeBalanceToDiscount(
  entries: readonly TimeBankEntry[],
  rows: readonly LegalParameterRow[],
  date: CivilDate,
  companyId: string | null = null,
): number {
  const reader = new ParameterReader(rows, date, { companyId });
  const balance = timeBankBalance(entries);
  if (balance >= 0 || !reader.bool(PARAM.timeBankAllowsNegativeDiscount)) return 0;
  return -balance;
}
