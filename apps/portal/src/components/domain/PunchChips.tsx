import type { Punch } from '@/lib/api/contracts';
import { formatTime } from '@/lib/format';

/**
 * Uma pastilha por marcação (HH:mm no fuso do estabelecimento). Marcação tratada pelo RH leva
 * a marca "ajustada". Número ímpar de marcações ganha a pastilha tracejada "sem saída" (só exibição;
 * a api é quem aponta a inconsistência).
 */
export function PunchChips({ punches, tz }: { punches: Punch[]; tz: string }) {
  if (punches.length === 0) return <span className="text-muted">Sem marcações</span>;
  const ordered = [...punches].sort((a, b) => a.sequence - b.sequence);
  const odd = ordered.length % 2 === 1;
  return (
    <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
      {ordered.map((p) => (
        <li key={p.sequence} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-white px-2.5 py-0.5 text-xs font-semibold tabular-nums">
          {formatTime(p.at, tz)}
          {p.origin === 'tratada' && <span className="rounded-full bg-tint px-1.5 text-[10px] font-semibold text-brand">ajustada</span>}
        </li>
      ))}
      {odd && (
        <li className="inline-flex items-center rounded-full border border-dashed border-danger px-2.5 py-0.5 text-xs font-semibold text-danger">sem saída</li>
      )}
    </ul>
  );
}
