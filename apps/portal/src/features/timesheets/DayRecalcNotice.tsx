'use client';
/** Resultado do "Recalcular dia": quantos foram recalculados e quem ficou de fora, agrupado pelo motivo que a api deu. */
import { DAY_RECALCULATE_SKIP_REASONS, type DayRecalculateResult, type EntityId } from '@/lib/api/contracts';
import { formatDate, plural } from '@/lib/format';
import { DAY_RECALCULATE_SKIP_REASON } from '@/lib/labels';
import { useEmployeeDirectory } from '@/lib/query/useEmployeeDirectory';
import { COPY, recalculatedText, skippedTitle } from './copy';

/** Nomes mostrados por motivo; o restante vira "e mais N". */
const MAX_NAMES = 10;

export function DayRecalcNotice({ date, result }: { date: string; result: DayRecalculateResult }) {
  return (
    <div role="status" className="rounded-md border border-line bg-tint px-4 py-3 text-sm">
      <strong>
        {formatDate(date)}: {recalculatedText(result.recalculated)}.
      </strong>{' '}
      {COPY.originalNeverChanges}
      {result.skipped.length > 0 && <Skipped skipped={result.skipped} />}
    </div>
  );
}

/** Separado para a lista de colaboradores só ser buscada quando alguém ficou de fora. */
function Skipped({ skipped }: { skipped: DayRecalculateResult['skipped'] }) {
  const directory = useEmployeeDirectory();
  const names = (ids: EntityId[]) => {
    if (directory.isPending) return COPY.loadingNames;
    const shown = ids.slice(0, MAX_NAMES).map((id) => directory.lookup(id).name);
    const more = ids.length - shown.length;
    return `${shown.join(', ')}${more > 0 ? ` e mais ${more}` : ''}`;
  };
  return (
    <div className="mt-1 flex flex-col gap-1 text-warn">
      <span className="font-semibold">{skippedTitle(skipped.length)}</span>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {DAY_RECALCULATE_SKIP_REASONS.map((reason) => {
          const ids = skipped.filter((s) => s.reason === reason).map((s) => s.employeeId);
          if (ids.length === 0) return null;
          return (
            <li key={reason}>
              {DAY_RECALCULATE_SKIP_REASON[reason].label} ({plural(ids.length, 'colaborador', 'colaboradores')}): {names(ids)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
