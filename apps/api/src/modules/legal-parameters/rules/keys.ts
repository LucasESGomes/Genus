/**
 * Chaves de `parametros_legais.chave` lidas pelas regras. Os valores vêm do
 * banco com vigência; aqui só o nome e o tipo esperado.
 *
 * As que já estão no comentário da tabela (schema-rh.sql) mantêm o nome de lá:
 * `jornada_semanal_max_min`, `tolerancia_batida_min`, `tolerancia_dia_min`,
 * `noturno_inicio`, `noturno_fim`, `interjornada_min`. As demais saem da
 * tabela de parâmetros do `04` G4 e das RN de §10, e precisam de seed.
 */
import type { NightWorkType } from '../../timesheets/rules/night';

export const PARAM = {
  // RN02, CLT art. 58 §1º, Súmula 366 TST (inteiro, minutos)
  tolerancePerPunch: 'tolerancia_batida_min',
  tolerancePerDay: 'tolerancia_dia_min',
  // RN03, CLT art. 71 (inteiro, minutos)
  longBreakAboveWorkMinutes: 'jornada_exige_intervalo_longo_acima_min',
  longBreakMinMinutes: 'intervalo_longo_min',
  shortBreakAboveWorkMinutes: 'jornada_exige_intervalo_curto_acima_min',
  shortBreakMinMinutes: 'intervalo_curto_min',
  // RN04, CLT art. 66 (inteiro, minutos)
  interjourneyMinMinutes: 'interjornada_min',
  // RN05, CLT art. 59 (inteiro, minutos)
  dailyOvertimeMaxMinutes: 'extras_diarias_max_min',
  // RN06, EC 141/2026 (inteiro, minutos; inteiro, dias)
  weeklyMaxMinutes: 'jornada_semanal_max_min',
  weeklyMinRestDays: 'folgas_semanais_min',
  // RN09, CLT art. 59 §§2º e 5º (inteiro, meses; inteiro, minutos; booleano)
  timeBankMonthsIndividual: 'banco_prazo_meses_individual',
  timeBankMonthsCollective: 'banco_prazo_meses_coletivo',
  timeBankNegativeMaxMinutes: 'banco_saldo_negativo_max_min',
  timeBankAllowsNegativeDiscount: 'banco_desconto_saldo_negativo',
  // RN10, CLT art. 130 (JSON: [{ "maxFaltas": 5, "dias": 30 }, ..., { "maxFaltas": null, "dias": 0 }])
  vacationAbsenceBands: 'ferias_faixas_faltas',
  // RN11, CLT arts. 134 e 135 (inteiros)
  vacationMaxPeriods: 'ferias_periodos_max',
  vacationMinPeriodDays: 'ferias_periodo_min_dias',
  vacationLongPeriodDays: 'ferias_periodo_longo_min_dias',
  vacationBlockedDaysBeforeRest: 'ferias_dias_vedados_antes_descanso',
  vacationNoticeDays: 'ferias_aviso_previo_dias',
  // CLT art. 143: abono de até 1/fração do direito (inteiro: 3)
  vacationCashAllowanceDivisor: 'ferias_abono_fracao_divisor',
} as const;

/**
 * RN07: janela e hora noturna por tipo de trabalho. Urbano usa as chaves do
 * schema (`noturno_inicio`/`noturno_fim`); rural ganha sufixo.
 * `hora_noturna_segundos_*`: 3150 = hora reduzida de 52 min 30 s; 3600 = sem redução.
 */
export function nightKeys(type: NightWorkType): { start: string; end: string; hourSeconds: string } {
  if (type === 'urbano') {
    return { start: 'noturno_inicio', end: 'noturno_fim', hourSeconds: 'hora_noturna_segundos' };
  }
  return {
    start: `noturno_inicio_${type}`,
    end: `noturno_fim_${type}`,
    hourSeconds: `hora_noturna_segundos_${type}`,
  };
}
