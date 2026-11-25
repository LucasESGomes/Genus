import { Warning } from '@phosphor-icons/react/dist/ssr';
import type { VacationCalendarRow, VacationStatus } from '@/lib/api/contracts';
import { formatDate, monthRange, weekdayShort } from '@/lib/format';
import { VACATION_STATUS } from '@/lib/labels';

/** Faixa por situação: aprovada cheia, solicitada tracejada, recusada âmbar; as demais, neutras. */
const BAR: Record<VacationStatus, string> = {
  aprovada: 'bg-brand text-white border border-brand',
  gozada: 'bg-ink-2 text-white border border-ink-2',
  solicitada: 'bg-tint text-brand border border-dashed border-brand',
  recusada: 'bg-warn-bg text-warn border border-warn',
  cancelada: 'bg-surface text-muted border border-line-strong',
};

const dayOf = (civil: string) => Number(civil.slice(8, 10));

export interface VacationGanttProps {
  /** AAAA-MM */
  month: string;
  rows: VacationCalendarRow[];
  /** Ocupação por dia (índice 0 = dia 1), já calculada pela api. */
  dailyOccupancy: number[];
  /** Limite de pessoas fora ao mesmo tempo, definido pela empresa. */
  maxSimultaneous: number;
  /** AAAA-MM-DD do dia atual (do Clock da tela). */
  today?: string;
  onSelect?: (row: VacationCalendarRow) => void;
}

/** Calendário de férias do mês: régua de dias, uma faixa por pedido e linha de ocupação. */
export function VacationGantt({ month, rows, dailyOccupancy, maxSimultaneous, today, onSelect }: VacationGanttProps) {
  const range = monthRange(month);
  const days = dayOf(range.to);
  const dayNumbers = Array.from({ length: days }, (_, i) => i + 1);
  const todayDay = today && today.slice(0, 7) === month ? dayOf(today) : null;
  const cell = 'min-w-[26px] px-0 text-center';

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card" tabIndex={0} role="region" aria-label="Calendário de férias">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">Calendário de férias do mês, uma linha por pedido</caption>
        <thead>
          <tr className="border-b border-line bg-surface">
            <th scope="col" className="sticky left-0 z-10 min-w-[200px] bg-surface px-4 py-2 text-left font-semibold text-muted">Pessoa</th>
            {dayNumbers.map((d) => {
              const civil = `${month}-${String(d).padStart(2, '0')}`;
              const isToday = d === todayDay;
              return (
                <th key={d} scope="col" className={`${cell} py-2 font-semibold ${isToday ? 'text-brand shadow-[inset_0_-3px_0_var(--color-accent)]' : 'text-muted'}`}>
                  <span className="block text-[10px] font-normal" aria-hidden>{weekdayShort(civil).charAt(0)}</span>
                  <span aria-hidden>{d}</span>
                  <span className="sr-only">{formatDate(civil, 'weekday')}{isToday ? ', hoje' : ''}</span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inside = row.endDate >= range.from && row.startDate <= range.to;
            const first = row.startDate < range.from ? 1 : dayOf(row.startDate);
            const last = row.endDate > range.to ? days : dayOf(row.endDate);
            const { label } = VACATION_STATUS[row.status];
            const period = `${formatDate(row.startDate, 'dayMonth')} a ${formatDate(row.endDate, 'dayMonth')}`;
            const name = `${row.employeeName}, ${label.toLowerCase()}, ${period}`;
            return (
              <tr key={row.vacationId} className="h-12 border-b border-line-soft last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-1 text-left font-normal">
                  <span className="block text-sm font-semibold text-ink">{row.employeeName}</span>
                  <span className="block text-muted">{label} · {period}</span>
                  {row.exceedsLimit && (
                    <span className="mt-0.5 inline-flex items-center gap-1 font-semibold text-warn">
                      <Warning size={12} weight="fill" aria-hidden />Passa do limite do setor
                    </span>
                  )}
                </th>
                {inside ? (
                  <>
                    {first > 1 && <td colSpan={first - 1} />}
                    <td colSpan={last - first + 1} className="p-0.5">
                      {onSelect ? (
                        <button type="button" aria-label={name} onClick={() => onSelect(row)} className={`h-7 w-full cursor-pointer truncate rounded-md px-2 text-left text-[11px] font-semibold ${BAR[row.status]}`}>
                          {last - first >= 3 ? period : ''}
                        </button>
                      ) : (
                        <div role="img" aria-label={name} className={`h-7 w-full truncate rounded-md px-2 text-[11px] font-semibold leading-6 ${BAR[row.status]}`}>
                          {last - first >= 3 ? period : ''}
                        </div>
                      )}
                    </td>
                    {last < days && <td colSpan={days - last} />}
                  </>
                ) : (
                  <td colSpan={days} />
                )}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-line bg-surface">
            <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left font-semibold text-muted">
              Fora ao mesmo tempo (limite {maxSimultaneous})
            </th>
            {dayNumbers.map((d) => {
              const n = dailyOccupancy[d - 1] ?? 0;
              const over = n > maxSimultaneous;
              return (
                <td key={d} className={`${cell} py-2 tabular-nums ${over ? 'font-bold text-warn' : 'text-ink-2'}`}>
                  {over && <Warning size={12} weight="fill" aria-hidden className="mx-auto" />}
                  {n}
                  {over && <span className="sr-only"> acima do limite</span>}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
      <ul aria-label="Legenda" className="m-0 flex list-none flex-wrap gap-4 border-t border-line p-3 text-xs text-muted">
        {(['aprovada', 'solicitada', 'recusada'] as const).map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-5 rounded-xs ${BAR[s]}`} />
            {VACATION_STATUS[s].label}
          </li>
        ))}
      </ul>
    </div>
  );
}
