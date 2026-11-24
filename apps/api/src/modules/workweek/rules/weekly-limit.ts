/**
 * Limite semanal de jornada (RN06, EC 141/2026).
 *
 * O limite e o mínimo de folgas vêm sempre de `parametros_legais` com vigência
 * (`jornada_semanal_max_min`, `folgas_semanais_min`): 44 h até 15/12/2026,
 * 42 h com 2 folgas de 16/12/2026 a 15/12/2027 e 40 h depois são linhas de
 * seed, não código. Há liminar pendente no STF (ADIs 8.041 e 8.042): se mudar,
 * muda a linha.
 *
 * Só avisa, nunca bloqueia (G2: "alerta de escala acima do limite"). Qual regra
 * vale para a semana que atravessa a data de troca é [A CONFIRMAR]: quem chama
 * escolhe a `referenceDate`.
 */
import { PARAM } from '../../legal-parameters/rules/keys';
import { ParameterReader, type LegalParameterRow } from '../../legal-parameters/rules/resolve';
import type { CivilDate } from '../../rules-common/rules/civil-time';

export interface WorkweekRule {
  maxWeeklyMinutes: number;
  minWeeklyRestDays: number;
  parameterVersion: string;
}

export function resolveWorkweekRule(
  rows: readonly LegalParameterRow[],
  date: CivilDate,
  companyId: string | null = null,
): WorkweekRule {
  const reader = new ParameterReader(rows, date, { companyId });
  return {
    maxWeeklyMinutes: reader.int(PARAM.weeklyMaxMinutes),
    minWeeklyRestDays: reader.int(PARAM.weeklyMinRestDays),
    parameterVersion: reader.version(),
  };
}

export interface PlannedDay {
  date: CivilDate;
  /** 0 = folga. */
  expectedMinutes: number;
}

export type WorkweekWarning =
  | { code: 'carga_semanal_acima_limite'; plannedMinutes: number; maxMinutes: number }
  | { code: 'folgas_abaixo_minimo'; restDays: number; minRestDays: number };

export function checkWeek(week: readonly PlannedDay[], rule: WorkweekRule): WorkweekWarning[] {
  const planned = week.reduce((s, d) => s + d.expectedMinutes, 0);
  const restDays = week.filter((d) => d.expectedMinutes === 0).length;
  const warnings: WorkweekWarning[] = [];
  if (planned > rule.maxWeeklyMinutes) {
    warnings.push({ code: 'carga_semanal_acima_limite', plannedMinutes: planned, maxMinutes: rule.maxWeeklyMinutes });
  }
  if (restDays < rule.minWeeklyRestDays) {
    warnings.push({ code: 'folgas_abaixo_minimo', restDays, minRestDays: rule.minWeeklyRestDays });
  }
  return warnings;
}
