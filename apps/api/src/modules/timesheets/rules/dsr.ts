/**
 * DSR: descanso semanal remunerado (RN08, Lei 605/1949 art. 6º).
 *
 * A VALIDAR PELO CONTADOR. Só a regra explícita da especificação está aqui: a
 * falta injustificada na semana tira a remuneração do DSR daquela semana. Falta
 * abonada (G5) ou coberta por afastamento (G7) não desconta. Ficam pendentes
 * (testes `todo`): reflexo das horas extras no DSR (fórmula [A CONFIRMAR] no
 * `04` G4), perda também do feriado da semana e efeito de atrasos.
 *
 * É calculado no fechamento (G10), sobre a semana inteira, não no dia.
 */
import type { CivilDate } from '../../rules-common/rules/civil-time';

export interface WeekDayForDsr {
  workDate: CivilDate;
  /** Minutos de falta do dia (`absenceMinutes` da apuração). */
  absenceMinutes: number;
  /** Minutos abonados (G5) no dia. */
  waivedMinutes: number;
  /** Dia coberto por afastamento ou férias aprovados. */
  coveredByLeave: boolean;
}

export interface DsrResult {
  /** `apuracoes_dia.dsr_descontado` do dia de repouso da semana. */
  dsrLost: boolean;
  /** Dias com falta injustificada que causaram a perda. */
  unjustifiedAbsenceDates: CivilDate[];
}

export function computeWeeklyRest(days: readonly WeekDayForDsr[]): DsrResult {
  const unjustified = days
    .filter((d) => !d.coveredByLeave && d.absenceMinutes - d.waivedMinutes > 0)
    .map((d) => d.workDate)
    .sort();
  return { dsrLost: unjustified.length > 0, unjustifiedAbsenceDates: unjustified };
}
