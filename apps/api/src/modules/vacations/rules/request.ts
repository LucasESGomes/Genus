/**
 * Pedido de férias (G9, RF41 a RF43, RN11, RN12).
 *
 * Espelha as triggers do schema (`fn_ferias_fracionamento`,
 * `fn_ferias_limite_setor`, `fn_ferias_inicio_valido`), que continuam sendo a
 * garantia final, e acrescenta o aviso prévio (RN11, art. 135). Diferenças em
 * relação às triggers:
 * - o descanso semanal vem da escala do colaborador (`restDays`), não de
 *   "sábado e domingo" como na simplificação da REGRA 4;
 * - o abono é somado entre os períodos do mesmo aquisitivo (a trigger olha só a linha).
 *
 * Vedação de fracionar para menores de 18 e maiores de 50 (antigo art. 134 §2º)
 * não está implementada: o parágrafo foi revogado pela Lei 13.467/2017 e não
 * aparece na especificação nem no schema (teste `todo`).
 */
import { PARAM } from '../../legal-parameters/rules/keys';
import { ParameterReader, type LegalParameterRow } from '../../legal-parameters/rules/resolve';
import { addDays, diffDays, rangesOverlap, type CivilDate } from '../../rules-common/rules/civil-time';
import { RhDomainError } from '../../rules-common/rules/errors';

export interface DateRange {
  start: CivilDate;
  end: CivilDate;
}

export interface VacationPeriod extends DateRange {
  /** `gozos_ferias.abono_pecuniario_dias`. */
  cashAllowanceDays: number;
}

export interface VacationRequestInput {
  request: VacationPeriod;
  /** Data em que o colaborador é avisado (art. 135). */
  noticeDate: CivilDate;
  /** `ferias_periodo_aquisitivo.dias_direito`. */
  entitlementDays: number;
  /** Outros períodos aprovados ou gozados do mesmo período aquisitivo. */
  sameAcquisitivePeriods: readonly VacationPeriod[];
  /** Todas as férias aprovadas ou gozadas da pessoa (REGRA 1). */
  ownApprovedPeriods: readonly DateRange[];
  /** `setores.limite_ferias_simultaneas` e as férias aprovadas ou gozadas de outros do setor. */
  sector: { limit: number; othersApproved: readonly DateRange[] };
  /** Feriados não facultativos do estabelecimento. */
  holidays: readonly CivilDate[];
  /** Folgas da escala do colaborador em torno do início. */
  restDays: readonly CivilDate[];
  companyId: string | null;
  parameters: readonly LegalParameterRow[];
}

export function periodDays(p: DateRange): number {
  return diffDays(p.start, p.end) + 1;
}

/** Todas as violações, na ordem das triggers. Lista vazia = pedido válido. */
export function validateVacationRequest(input: VacationRequestInput): RhDomainError[] {
  const { request } = input;
  if (request.end < request.start) {
    return [new RhDomainError('FERIAS_PERIODO_INVALIDO', 'O fim das férias é anterior ao início', {})];
  }
  // Parâmetros vigentes no início do gozo [A CONFIRMAR]
  const reader = new ParameterReader(input.parameters, request.start, { companyId: input.companyId });
  const maxPeriods = reader.int(PARAM.vacationMaxPeriods);
  const minDays = reader.int(PARAM.vacationMinPeriodDays);
  const longDays = reader.int(PARAM.vacationLongPeriodDays);
  const blockedBefore = reader.int(PARAM.vacationBlockedDaysBeforeRest);
  const noticeDays = reader.int(PARAM.vacationNoticeDays);
  const divisor = reader.int(PARAM.vacationCashAllowanceDivisor);

  const errors: RhDomainError[] = [];
  const days = periodDays(request);
  const others = input.sameAcquisitivePeriods;

  if (days < minDays) {
    errors.push(new RhDomainError('FERIAS_PERIODO_CURTO', `Cada período de férias precisa ter ao menos ${minDays} dias`, { days, minDays }));
  }

  if (others.length + 1 > maxPeriods) {
    errors.push(new RhDomainError('FERIAS_FRACIONAMENTO_INVALIDO', `Férias em no máximo ${maxPeriods} períodos (CLT art. 134 §1º)`, { maxPeriods }));
  }

  const usedOthers = others.reduce((s, p) => s + periodDays(p) + p.cashAllowanceDays, 0);
  const total = usedOthers + days + request.cashAllowanceDays;
  if (total > input.entitlementDays) {
    errors.push(new RhDomainError('FERIAS_SALDO_INSUFICIENTE', 'Os dias pedidos passam do direito do período aquisitivo', { total, entitlement: input.entitlementDays }));
  }

  const allowanceTotal = others.reduce((s, p) => s + p.cashAllowanceDays, 0) + request.cashAllowanceDays;
  const allowanceMax = Math.floor(input.entitlementDays / divisor);
  if (allowanceTotal > allowanceMax) {
    errors.push(new RhDomainError('FERIAS_ABONO_ACIMA_LIMITE', `Abono pecuniário limitado a ${allowanceMax} dias (CLT art. 143)`, { allowanceTotal, allowanceMax }));
  }

  // Um período longo só é cobrado quando o saldo acaba (como na trigger):
  // cobrar antes impediria marcar 5 dias primeiro e 14 depois.
  const hasLong = days >= longDays || others.some((p) => periodDays(p) >= longDays);
  if (others.length > 0 && total === input.entitlementDays && !hasLong) {
    errors.push(new RhDomainError('FERIAS_FRACIONAMENTO_INVALIDO', `Um dos períodos precisa ter ${longDays} dias ou mais (CLT art. 134 §1º)`, { longDays }));
  }

  // RN11, art. 134 §3º: não começa em feriado ou descanso, nem nos N dias antes
  const blocked = new Set([...input.holidays, ...input.restDays]);
  for (let k = 0; k <= blockedBefore; k++) {
    if (blocked.has(addDays(request.start, k))) {
      errors.push(new RhDomainError('FERIAS_INICIO_VEDADO', `Férias não podem começar em feriado ou descanso semanal, nem nos ${blockedBefore} dias anteriores (CLT art. 134 §3º)`, { start: request.start }));
      break;
    }
  }

  // RN11, art. 135: aviso com antecedência mínima
  const notice = diffDays(input.noticeDate, request.start);
  if (notice < noticeDays) {
    errors.push(new RhDomainError('FERIAS_AVISO_INSUFICIENTE', `O aviso de férias precisa ser dado com ${noticeDays} dias de antecedência (CLT art. 135)`, { notice, noticeDays }));
  }

  // REGRA 1: a mesma pessoa nunca tem dois períodos no mesmo dia
  if (input.ownApprovedPeriods.some((p) => rangesOverlap(p.start, p.end, request.start, request.end))) {
    errors.push(new RhDomainError('FERIAS_SOBREPOSTAS', 'Já há férias aprovadas nesse intervalo', {}));
  }

  // REGRA 2: setor não fica desfalcado (mesma contagem da trigger)
  const inVacation = input.sector.othersApproved.filter((p) =>
    rangesOverlap(p.start, p.end, request.start, request.end),
  ).length;
  if (inVacation >= input.sector.limit) {
    errors.push(new RhDomainError('FERIAS_SETOR_DESFALCADO', 'O setor ficaria desfalcado nesse intervalo', { inVacation, limit: input.sector.limit }));
  }

  return errors;
}

export function assertVacationRequest(input: VacationRequestInput): void {
  const [first] = validateVacationRequest(input);
  if (first) throw first;
}

/** RN12, CLT art. 137: dias gozados depois do fim do período concessivo são pagos em dobro. */
export function daysPaidInDouble(period: DateRange, concessiveEnd: CivilDate): number {
  if (period.end <= concessiveEnd) return 0;
  const from = period.start > concessiveEnd ? period.start : addDays(concessiveEnd, 1);
  return diffDays(from, period.end) + 1;
}
