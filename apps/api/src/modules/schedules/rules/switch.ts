/**
 * Troca de escala (RF09): regra pura. O colaborador tem vínculos de escala sem
 * sobreposição (EXCLUDE colab_escala_sem_sobreposicao). Trocar a partir de D:
 *   - vínculo que começa em D: troca só a escala dele (`replace`);
 *   - vínculo que cobre D e começou antes: termina em D - 1 (`close`);
 *   - o novo vínculo vai de D até o dia anterior ao próximo vínculo, ou fica em aberto.
 */
import { addDays, type CivilDate } from '../../rules-common/rules/civil-time';

export interface AssignmentRange {
  id: number;
  scheduleId: number;
  validFrom: CivilDate;
  validTo: CivilDate | null;
}

export type SwitchPlan =
  | { kind: 'replace'; current: AssignmentRange }
  | {
      kind: 'insert';
      close: { id: number; validTo: CivilDate; previousValidTo: CivilDate | null } | null;
      newValidTo: CivilDate | null;
    };

const covers = (a: AssignmentRange, d: CivilDate) => a.validFrom <= d && (a.validTo === null || d <= a.validTo);

export function planSwitch(assignments: readonly AssignmentRange[], from: CivilDate): SwitchPlan {
  const current = assignments.find((a) => covers(a, from));
  if (current && current.validFrom === from) return { kind: 'replace', current };
  const nextStart = assignments
    .filter((a) => a.validFrom > from)
    .map((a) => a.validFrom)
    .sort()[0];
  return {
    kind: 'insert',
    close: current ? { id: current.id, validTo: addDays(from, -1), previousValidTo: current.validTo } : null,
    // o vínculo atual pode terminar depois do próximo começar? Não: o EXCLUDE impede. O novo termina antes do próximo.
    newValidTo: nextStart ? addDays(nextStart, -1) : current?.validTo ?? null,
  };
}
