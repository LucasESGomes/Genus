import type { Punch } from '@/lib/api/contracts';
import { formatInstant, formatMinutes } from '@/lib/format';

const DAY = 24 * 60;
const HOURS = [0, 6, 12, 18, 24];

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const pct = (min: number) => `${(Math.min(Math.max(min, 0), DAY) / DAY) * 100}%`;

/** Barra de 0 a 24 h: faixas entre as marcações em pares (entrada/saída) e, ao fundo, a jornada prevista. */
export function DayTimeline({ punches, tz, expected }: { punches: Punch[]; tz: string; expected?: { start: string; end: string } }) {
  const ordered = [...punches].sort((a, b) => a.sequence - b.sequence);
  const mins = ordered.map((p) => toMinutes(formatInstant(p.at, tz, 'HH:mm')));
  const pairs: { from: number; to: number | null }[] = [];
  for (let i = 0; i < mins.length; i += 2) pairs.push({ from: mins[i] ?? 0, to: mins[i + 1] ?? null });

  const summary = pairs.length
    ? pairs.map((p) => (p.to === null ? `entrada às ${formatMinutes(p.from)} sem saída` : `das ${formatMinutes(p.from)} às ${formatMinutes(p.to)}`)).join('; ')
    : 'sem marcações';
  const label = `Linha do dia: ${summary}${expected ? `. Jornada prevista das ${expected.start} às ${expected.end}` : ''}`;

  return (
    <div>
      <div role="img" aria-label={label} className="relative h-3 overflow-hidden rounded-full bg-surface">
        {expected && (
          <div aria-hidden className="absolute inset-y-0 bg-tint" style={{ left: pct(toMinutes(expected.start)), width: pct(Math.max(toMinutes(expected.end) - toMinutes(expected.start), 0)) }} />
        )}
        {pairs.map((p, i) =>
          p.to === null ? (
            <div key={i} aria-hidden className="absolute inset-y-0 w-1.5 rounded-full border border-dashed border-danger bg-danger-bg" style={{ left: pct(p.from) }} />
          ) : (
            <div key={i} aria-hidden className="absolute inset-y-0 rounded-full bg-brand" style={{ left: pct(p.from), width: pct(Math.max(p.to - p.from, 0)) }} />
          ),
        )}
      </div>
      <div aria-hidden className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
        {HOURS.map((h) => <span key={h}>{String(h).padStart(2, '0')}h</span>)}
      </div>
    </div>
  );
}

