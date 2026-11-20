import type { Pool } from 'pg';
import { toSafeInt } from './safe-int.js';

const REQUIRED_EVENTS = ['generate-receipt-pdf', 'recalculate-day', 'official-qr'] as const;

/** Situação de uma entrada `processado`, como o banco a enxerga. */
export interface ProcessedEntryState {
  entryId: number;
  hasEvidence: boolean;
  hasRecord: boolean;
  outboxEventCount: number;
}

export interface InvariantProblem {
  entryId: number;
  reason: string;
}

/**
 * Regra pura (testável sem banco): entrada `processado` precisa de evidência,
 * registro e os 3 eventos de outbox (SPEC §2, item 5).
 */
export function evaluateInvariant(states: readonly ProcessedEntryState[]): InvariantProblem[] {
  const problems: InvariantProblem[] = [];
  for (const s of states) {
    if (!s.hasEvidence) problems.push({ entryId: s.entryId, reason: 'sem evidência' });
    else if (!s.hasRecord) problems.push({ entryId: s.entryId, reason: 'sem registro' });
    else if (s.outboxEventCount !== REQUIRED_EVENTS.length) {
      problems.push({
        entryId: s.entryId,
        reason: `outbox com ${s.outboxEventCount} de ${REQUIRED_EVENTS.length} eventos`,
      });
    }
  }
  return problems;
}

interface StateRow {
  id: string;
  evidencia_nsr: string | null;
  tem_registro: boolean;
  eventos: string;
}

/** Lista entradas `processado` do estabelecimento que violam o invariante (use `arp_reader`). */
export async function checkProcessedInvariant(
  pool: Pool,
  input: { tenantId: number; establishmentId: number },
): Promise<InvariantProblem[]> {
  const res = await pool.query<StateRow>(
    `SELECT e.id,
            ev.nsr AS evidencia_nsr,
            (r.nsr IS NOT NULL) AS tem_registro,
            (SELECT count(DISTINCT o.evento)
               FROM outbox o
              WHERE o.conta_id = e.conta_id
                AND o.estabelecimento_id = e.estabelecimento_id
                AND ev.nsr IS NOT NULL
                AND o.chave = e.estabelecimento_id::text || '-' || ev.nsr::text
                AND o.evento = ANY($3::text[])) AS eventos
       FROM entradas e
       LEFT JOIN evidencias ev ON ev.entrada_id = e.id AND ev.conta_id = e.conta_id
       LEFT JOIN registros r ON r.estabelecimento_id = ev.estabelecimento_id AND r.nsr = ev.nsr
                            AND r.conta_id = e.conta_id
      WHERE e.conta_id = $1 AND e.estabelecimento_id = $2 AND e.status = 'processado'
      ORDER BY e.id`,
    [input.tenantId, input.establishmentId, [...REQUIRED_EVENTS]],
  );
  return evaluateInvariant(
    res.rows.map((r) => ({
      entryId: toSafeInt(r.id, 'entradas.id'),
      hasEvidence: r.evidencia_nsr !== null,
      hasRecord: r.tem_registro,
      outboxEventCount: toSafeInt(r.eventos, 'eventos'),
    })),
  );
}
