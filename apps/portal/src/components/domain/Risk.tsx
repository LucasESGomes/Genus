import type { RiskLevel } from '@/lib/api/contracts';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { RISK_LEVEL, type LabelTone } from '@/lib/labels';

/** Selo do nível de risco. O nível vem da api; a nota é só complemento de leitura. */
export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const { label, tone } = RISK_LEVEL[level];
  return <StatusBadge tone={tone} label={`Risco ${label.toLowerCase()}${score !== undefined ? ` · ${score}` : ''}`} />;
}

const FILL: Partial<Record<LabelTone, string>> = { good: 'bg-good', warn: 'bg-warn', danger: 'bg-danger' };

/** Barra 0–100 da nota de risco. A cor e o texto seguem o `level` da api, nunca a nota. */
export function RiskBar({ level, score }: { level: RiskLevel; score: number }) {
  const { label, tone } = RISK_LEVEL[level];
  const value = Math.min(Math.max(Math.round(score), 0), 100);
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label="Nota de risco"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value} de 100, risco ${label.toLowerCase()}`}
        className="h-2 w-full min-w-[80px] overflow-hidden rounded-full bg-skeleton"
      >
        <div className={`h-full rounded-full ${FILL[tone] ?? 'bg-muted'}`} style={{ width: `${value}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs font-semibold tabular-nums">{value}/100 · {label}</span>
    </div>
  );
}
