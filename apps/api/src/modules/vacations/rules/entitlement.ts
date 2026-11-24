/**
 * Dias de férias de direito pelas faltas injustificadas do período aquisitivo
 * (RN10, CLT art. 130). As faixas vêm de `parametros_legais` (`ferias_faixas_faltas`);
 * o CHECK `pa_direito_bate_faltas` do schema confere o mesmo resultado no banco.
 */
import { PARAM } from '../../legal-parameters/rules/keys';
import { ParameterReader, type LegalParameterRow } from '../../legal-parameters/rules/resolve';
import type { CivilDate } from '../../rules-common/rules/civil-time';
import { RhDomainError } from '../../rules-common/rules/errors';

/** `maxFaltas: null` = faixa final ("acima de"). */
export interface AbsenceBand {
  maxFaltas: number | null;
  dias: number;
}

function isBands(value: unknown): value is AbsenceBand[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (b: unknown) =>
        typeof b === 'object' &&
        b !== null &&
        Number.isSafeInteger((b as AbsenceBand).dias) &&
        ((b as AbsenceBand).maxFaltas === null || Number.isSafeInteger((b as AbsenceBand).maxFaltas)),
    )
  );
}

export function vacationEntitlementDays(
  unjustifiedAbsences: number,
  rows: readonly LegalParameterRow[],
  date: CivilDate,
  companyId: string | null = null,
): number {
  if (!Number.isSafeInteger(unjustifiedAbsences) || unjustifiedAbsences < 0) {
    throw new RhDomainError('DATA_INVALIDA', 'Número de faltas inválido', { unjustifiedAbsences });
  }
  const reader = new ParameterReader(rows, date, { companyId });
  const bands = reader.json(PARAM.vacationAbsenceBands, isBands, 'lista de faixas { maxFaltas, dias }');
  const ordered = [...bands].sort((a, b) => (a.maxFaltas ?? Infinity) - (b.maxFaltas ?? Infinity));
  const band = ordered.find((b) => b.maxFaltas === null || unjustifiedAbsences <= b.maxFaltas);
  if (!band) {
    throw new RhDomainError('PARAMETRO_INVALIDO', 'As faixas de férias não cobrem esse número de faltas', {
      unjustifiedAbsences,
    });
  }
  return band.dias;
}
