import { ArrowDownRight, ArrowUpRight, Clock, FirstAidKit, SunHorizon, Timer, UserMinus} from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { OverviewKpi, Tone } from '@/lib/api/contracts';
import { Card } from './Card';

const ICON: Record<OverviewKpi['key'], Icon> = {
  workedHours: Clock, overtimeHours: Timer, absences: UserMinus, pendingCertificates: FirstAidKit, activeVacations: SunHorizon,
};
const TONE: Record<Tone, string> = { good: 'bg-tint text-brand', warn: 'bg-warn-bg text-warn', neutral: 'bg-surface text-muted' };

export function KpiCard({ kpi }: { kpi: OverviewKpi }) {
  const I = ICON[kpi.key];
  const Arrow = kpi.trend === 'up' ? ArrowUpRight : ArrowDownRight;
  return (
    <Card className="flex flex-col gap-1.5 p-5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted"><I size={16} aria-hidden />{kpi.label}</div>
      <div className="text-2xl font-bold tracking-[-0.02em] tabular-nums">
        {kpi.value}
        {kpi.unit && <span className="ml-1 text-sm font-semibold text-muted">{kpi.unit}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold tabular-nums ${TONE[kpi.tone]}`}>
          <Arrow size={12} aria-label={kpi.trend === 'up' ? 'Alta' : 'Queda'} />{kpi.delta}
        </span>
        <span className="text-muted">{kpi.comparison}</span>
      </div>
    </Card>
  );
}
