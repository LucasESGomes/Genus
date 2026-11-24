/**
 * Linhas de `parametros_legais` que valem para uma empresa: o padrão legal
 * (conta NULL) e as da conta. Uma linha da conta sem empresa vale para todas
 * as empresas da conta e, como a da empresa, tem precedência sobre o padrão
 * (resolve.ts). A data de vigência é escolhida por quem calcula.
 */
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { legalParameters } from '../../db/schema';
import type { LegalParameterRow } from './rules/resolve';

export async function loadLegalParameters(ex: Executor, tenantId: number, companyId: number): Promise<LegalParameterRow[]> {
  const rows = await ex
    .select({
      id: legalParameters.id,
      tenantId: legalParameters.tenantId,
      companyId: legalParameters.companyId,
      key: legalParameters.key,
      value: legalParameters.value,
      legalBasis: legalParameters.legalBasis,
      validFrom: legalParameters.validFrom,
      validTo: legalParameters.validTo,
    })
    .from(legalParameters)
    .where(
      or(
        isNull(legalParameters.tenantId),
        and(eq(legalParameters.tenantId, tenantId), or(isNull(legalParameters.companyId), eq(legalParameters.companyId, companyId))),
      ),
    );
  return rows.map((r) => ({
    id: String(r.id),
    companyId: r.tenantId === null ? null : String(r.companyId ?? companyId),
    key: r.key,
    value: r.value,
    legalBasis: r.legalBasis,
    validFrom: r.validFrom,
    validTo: r.validTo,
  }));
}
