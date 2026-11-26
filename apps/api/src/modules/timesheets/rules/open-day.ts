/**
 * Dia aberto (a janela do dia ainda não terminou): o colaborador pode bater o
 * ponto mais tarde, então nada que dependa do resto do dia é acusado. Ficam as
 * marcações e os minutos; saem falta, atraso, saída antecipada, batida ímpar ou
 * faltando e intervalo não cumprido. O cálculo completo (e o lançamento no banco
 * de horas) acontece quando o dia encerra. Função pura (RNF05).
 */
import type { DayResult, InconsistencyCode } from './day';

const ONLY_ON_CLOSED_DAY: readonly InconsistencyCode[] = [
  'marcacoes_impares',
  'marcacao_ausente',
  'intervalo_ausente',
  'intervalo_insuficiente',
];

export function asOpenDay(result: DayResult): DayResult {
  const inconsistencies = result.inconsistencies.filter((c) => !ONLY_ON_CLOSED_DAY.includes(c));
  return {
    ...result,
    // sem marcação até agora ainda não é falta
    situation: result.situation === 'falta' ? 'normal' : result.situation,
    status: inconsistencies.includes('marcacao_duplicada') ? 'inconsistente' : 'calculada',
    suppressedBreakMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    shortfallMinutes: 0,
    absenceMinutes: 0,
    inconsistencies,
  };
}
