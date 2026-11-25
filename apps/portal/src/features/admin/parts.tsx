'use client';
/** Peças compartilhadas das telas do painel da operação (usadas também pelas telas de auditoria, acessos, reconhecimento e saúde). */
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ApiError, asApiError } from '@/lib/api/errors';
import { STATS_WINDOWS, type HealthState, type StatsWindow } from '@/lib/api/super-admin-contracts';
import { formatNumber } from '@/lib/format';
import type { LabelTone } from '@/lib/labels';
import { HEALTH_STATE_LABEL, superAdminErrorMessage, WINDOW_LABEL } from '@/lib/labels/super-admin';

/** Janela de tempo (24h, 7d, 30d) como grupo de botões. */
export function WindowSelect({ value, onChange, label = 'Período' }: { value: StatsWindow; onChange: (w: StatsWindow) => void; label?: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full border border-line-strong bg-white p-0.5">
      {STATS_WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={value === w}
          title={WINDOW_LABEL[w]}
          onClick={() => onChange(w)}
          className={`h-9 cursor-pointer rounded-full border-0 px-4 text-sm font-semibold ${value === w ? 'bg-brand text-white' : 'bg-transparent text-ink-2 hover:bg-surface'}`}
        >
          {w}
        </button>
      ))}
    </div>
  );
}

export const HEALTH_TONE: Record<HealthState, LabelTone> = { ok: 'good', degraded: 'warn', down: 'danger' };

export function HealthBadge({ state }: { state: HealthState }) {
  return <StatusBadge label={HEALTH_STATE_LABEL[state]} tone={HEALTH_TONE[state]} />;
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="flex flex-col gap-1.5 p-5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="text-2xl font-bold tracking-[-0.02em] tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export interface BarDatum {
  label: string;
  value: number;
}

/**
 * Gráfico de barras simples em SVG, sem dependência. Acessível: o gráfico é uma imagem com resumo
 * e os valores completos ficam numa tabela só para leitor de tela.
 */
export function BarChart({ data, ariaLabel, valueLabel = 'Batidas', height = 140 }: { data: BarDatum[]; ariaLabel: string; valueLabel?: string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 2;
  const width = Math.max(1, data.length) * 12;
  return (
    <figure className="m-0">
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-36 w-full text-brand">
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 1 : 0, (d.value / max) * (height - 4));
          return (
            <rect key={`${d.label}-${i}`} x={i * 12 + gap / 2} y={height - h} width={12 - gap} height={h} rx={1.5} fill="currentColor">
              <title>{`${d.label}: ${formatNumber(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted tabular-nums" aria-hidden>
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <table className="sr-only">
        <caption>{ariaLabel}</caption>
        <thead><tr><th scope="col">Dia</th><th scope="col">{valueLabel}</th></tr></thead>
        <tbody>
          {data.map((d, i) => <tr key={`${d.label}-${i}`}><th scope="row">{d.label}</th><td>{d.value}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}

/** Erro da api com a mensagem em pt-BR dos códigos conhecidos; os demais mantêm o texto já tratado do cliente. */
export function friendlyError(e: unknown): ApiError {
  const err = asApiError(e);
  const known = superAdminErrorMessage(err.code);
  const isKnown = known !== superAdminErrorMessage(undefined);
  return isKnown ? new ApiError(err.kind, err.status, err.code, known, err.fields) : err;
}

/** 0.982 → "98,2%"; null → "—". */
export const formatPercent = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
