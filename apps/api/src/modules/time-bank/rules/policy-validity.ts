/**
 * Vigência da regra do banco de horas de um estabelecimento. Função pura.
 *
 * As vigências são fechadas nas duas pontas (fim NULL = em aberto) e não se
 * sobrepõem. A "vigente" é a que vale hoje ou a próxima:
 * - início igual ao de uma regra existente: atualiza essa regra;
 * - início posterior à vigente: encerra a anterior na véspera e cria a nova
 *   (até a véspera da seguinte, se já houver uma agendada);
 * - início anterior à vigente: recusa.
 */
import { addDays, type CivilDate } from '../../rules-common/rules/civil-time';

export interface PolicyPeriod {
  id: number;
  validFrom: CivilDate;
  validTo: CivilDate | null;
}

export type PolicyChange =
  | { kind: 'conflict' }
  | { kind: 'update'; id: number }
  | { kind: 'insert'; closePrevious: { id: number; validTo: CivilDate } | null; validTo: CivilDate | null };

const byStart = (a: PolicyPeriod, b: PolicyPeriod) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0);

/** A regra que vale em `today` ou a próxima; null se não houver nenhuma. */
export function currentOrNextPolicy<T extends PolicyPeriod>(periods: readonly T[], today: CivilDate): T | null {
  return [...periods].sort(byStart).find((p) => p.validTo === null || p.validTo >= today) ?? null;
}

export function planPolicyChange(periods: readonly PolicyPeriod[], validFrom: CivilDate, today: CivilDate): PolicyChange {
  const sorted = [...periods].sort(byStart);
  // Sem regra vigente nem futura (todas encerradas), a referência é a última.
  const reference = currentOrNextPolicy(sorted, today) ?? sorted.at(-1);
  if (reference && validFrom < reference.validFrom) return { kind: 'conflict' };

  const same = sorted.find((p) => p.validFrom === validFrom);
  if (same) return { kind: 'update', id: same.id };

  const previous = sorted.filter((p) => p.validFrom < validFrom).at(-1);
  const next = sorted.find((p) => p.validFrom > validFrom);
  const overlaps = previous !== undefined && (previous.validTo === null || previous.validTo >= validFrom);
  return {
    kind: 'insert',
    closePrevious: overlaps ? { id: previous.id, validTo: addDays(validFrom, -1) } : null,
    validTo: next ? addDays(next.validFrom, -1) : null,
  };
}
