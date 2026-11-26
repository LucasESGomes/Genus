/**
 * Quanto um dia apurado vale no banco de horas (G8, RF33, RF34). Função pura.
 *
 * O resultado é o alvo do dia: a soma dos lançamentos daquele dia tem de ser
 * igual a ele. Positivo é crédito, negativo é débito.
 *
 * - Crédito: extra a 50% + extra de dia de descanso, esta com o peso da regra
 *   (feriado: `peso_feriado`; domingo: `peso_domingo`; outra folga: 1,00) [A CONFIRMAR].
 * - Feriado com tratamento `pagar_100` vai para a folha, não para o banco.
 * - Débito: só o que faltou em dia `normal` (atraso e saída antecipada). Falta
 *   integral não debita: fica em `minutos_falta`, para a folha [A CONFIRMAR].
 * - Dia inconsistente, férias ou afastamento: zero.
 */
import { isoWeekday } from '../../rules-common/rules/civil-time';
import type { DayResult } from '../../timesheets/rules/day';
import { parseWeightHundredths, weightedCreditMinutes } from './ledger';

/** Pesos da regra do banco, como no banco de dados (NUMERIC(3,2), ex.: "1.50"). */
export interface PostingWeights {
  sundayWeight: string;
  holidayWeight: string;
}

export type PostingDay = Pick<
  DayResult,
  'workDate' | 'situation' | 'status' | 'overtime50Minutes' | 'overtime100Minutes' | 'shortfallMinutes' | 'holidayTreatment'
>;

const SUNDAY = 7;

export function dayTargetMinutes(day: PostingDay, weights: PostingWeights): number {
  if (day.status === 'inconsistente' || day.situation === 'ferias' || day.situation === 'afastamento') return 0;
  const isHoliday = day.situation === 'feriado';
  if (isHoliday && day.holidayTreatment === 'pagar_100') return 0;

  const weight = isHoliday
    ? parseWeightHundredths(weights.holidayWeight)
    : isoWeekday(day.workDate) === SUNDAY
      ? parseWeightHundredths(weights.sundayWeight)
      : 100;
  const credit = day.overtime50Minutes + weightedCreditMinutes(day.overtime100Minutes, weight);
  const debit = day.situation === 'normal' ? day.shortfallMinutes : 0;
  return credit - debit;
}
