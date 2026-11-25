import { ArrowDownRight, ArrowUpRight, Clock } from '@phosphor-icons/react/dist/ssr';
import type { OverviewKpi } from '@/lib/api/contracts';
import { Card } from '@/components/ui/Card';

/**
 * KPI em destaque: número-chave em `accent` sobre `brand` (uso permitido da cor de destaque).
 * Só um por tela. O delta e a comparação ficam em branco: o limão não vai em texto pequeno.
 */
export function FeaturedKpiCard({ kpi }: { kpi: OverviewKpi }) {
  const Arrow = kpi.trend === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="flex flex-col gap-1.5 border-brand bg-brand p-5 text-white">
      <div className="flex items-center gap-1.5 text-xs font-medium text-white/80"><Clock size={16} aria-hidden />{kpi.label}</div>
      <div className="text-2xl font-bold tracking-[-0.02em] tabular-nums text-accent">
        {kpi.value}
        {kpi.unit && <span className="ml-1 text-sm font-semibold text-white/80">{kpi.unit}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-0.5 rounded-full bg-white/15 px-2 py-0.5 font-semibold tabular-nums">
          <Arrow size={12} aria-label={kpi.trend === 'up' ? 'Alta' : 'Queda'} />{kpi.delta}
        </span>
        <span className="text-white/80">{kpi.comparison}</span>
      </div>
    </Card>
  );
}
