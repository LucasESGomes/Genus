'use client';
/**
 * Gráficos da visão geral (G11). Dados prontos da api; o front só converte minutos em horas.
 * Paleta: chart-2 (azul) e chart-4 (âmbar), validada para daltonismo (dataviz/validate_palette).
 * Situação dos dias usa as cores de status, sempre com rótulo e número. Cada gráfico tem a
 * tabela equivalente (botão "Ver como tabela") para leitor de tela e impressão.
 */
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/Card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/shadcn/chart';
import type { Overview, OverviewSeriesPoint } from '@/lib/api/contracts';
import { COPY } from './copy';

const h1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const toHours = (m: number) => Math.round((m / 60) * 10) / 10;
const fmtHours = (m: number) => `${h1.format(toHours(m))} h`;
const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function Legend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-4 p-0 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${i.className}`} />{i.label}</li>
      ))}
    </ul>
  );
}

function ChartCard({ title, hint, summary, children, table }: { title: string; hint?: string; summary: string; children: React.ReactNode; table: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card as="section" className="flex min-w-0 flex-col gap-3 p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{title}</h2>
          {hint && <p className="m-0 text-xs text-muted">{hint}</p>}
        </div>
        <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-brand" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
          {asTable ? 'Ver gráfico' : COPY.table}
        </button>
      </div>
      <p className="sr-only">{summary}</p>
      {asTable ? <div className="max-h-72 overflow-auto">{table}</div> : <div aria-hidden>{children}</div>}
    </Card>
  );
}

function SeriesTable({ series, cols }: { series: OverviewSeriesPoint[]; cols: { label: string; value: (p: OverviewSeriesPoint) => string }[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="py-1 font-semibold">Dia</th>
          {cols.map((c) => <th key={c.label} className="py-1 text-right font-semibold">{c.label}</th>)}
        </tr>
      </thead>
      <tbody>
        {series.map((p) => (
          <tr key={p.date} className="border-t border-line-soft">
            <td className="py-1 tabular-nums">{dayLabel(p.date)}</td>
            {cols.map((c) => <td key={c.label} className="py-1 text-right tabular-nums">{c.value(p)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const hoursConfig: ChartConfig = {
  regular: { label: 'Normais', color: 'var(--color-chart-2)' },
  extra: { label: COPY.overtime, color: 'var(--color-chart-4)' },
};

/** Barras empilhadas: horas normais + extras = trabalhadas no dia. */
export function HoursChart({ series }: { series: OverviewSeriesPoint[] }) {
  const data = series.map((p) => ({ date: p.date, regular: toHours(Math.max(p.workedMinutes - p.overtimeMinutes, 0)), extra: toHours(p.overtimeMinutes) }));
  const worked = series.reduce((s, p) => s + p.workedMinutes, 0);
  const extra = series.reduce((s, p) => s + p.overtimeMinutes, 0);
  return (
    <ChartCard
      title={COPY.hoursTitle}
      hint={COPY.hoursHint}
      summary={`${COPY.hoursTitle}: ${fmtHours(worked)} trabalhadas, das quais ${fmtHours(extra)} extras, em ${series.length} dias.`}
      table={<SeriesTable series={series} cols={[{ label: COPY.worked, value: (p) => fmtHours(p.workedMinutes) }, { label: COPY.overtime, value: (p) => fmtHours(p.overtimeMinutes) }]} />}
    >
      <ChartContainer config={hoursConfig} className="aspect-auto h-64 w-full">
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
          <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} minTickGap={12} fontSize={11} />
          <YAxis width={40} tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v: number) => h1.format(v)} />
          <ChartTooltip cursor={{ fill: 'var(--color-tint)' }} content={<ChartTooltipContent labelFormatter={(l) => dayLabel(String(l))} formatter={(v, name) => (
            <span className="flex w-full justify-between gap-3"><span>{hoursConfig[String(name)]?.label}</span><span className="font-semibold tabular-nums">{h1.format(Number(v))} h</span></span>
          )} />} />
          <Bar dataKey="regular" stackId="h" fill="var(--color-regular)" stroke="var(--color-white)" strokeWidth={2} isAnimationActive={false} />
          <Bar dataKey="extra" stackId="h" fill="var(--color-extra)" stroke="var(--color-white)" strokeWidth={2} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <Legend items={[{ label: 'Normais', className: 'bg-chart-2' }, { label: COPY.overtime, className: 'bg-chart-4' }]} />
    </ChartCard>
  );
}

const issuesConfig: ChartConfig = {
  absences: { label: COPY.absences, color: 'var(--color-chart-2)' },
  inconsistent: { label: COPY.inconsistent, color: 'var(--color-chart-4)' },
};

/** Barras agrupadas: faltas e dias inconsistentes (mesma unidade: dias de colaborador). */
export function IssuesChart({ series }: { series: OverviewSeriesPoint[] }) {
  const absences = series.reduce((s, p) => s + p.absences, 0);
  const inconsistent = series.reduce((s, p) => s + p.inconsistent, 0);
  return (
    <ChartCard
      title={COPY.issuesTitle}
      hint={COPY.issuesHint}
      summary={`${COPY.issuesTitle}: ${absences} faltas e ${inconsistent} dias inconsistentes no período.`}
      table={<SeriesTable series={series} cols={[{ label: COPY.absences, value: (p) => String(p.absences) }, { label: COPY.inconsistent, value: (p) => String(p.inconsistent) }]} />}
    >
      <ChartContainer config={issuesConfig} className="aspect-auto h-52 w-full">
        <BarChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false} barGap={2} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="var(--color-line-soft)" />
          <XAxis dataKey="date" tickFormatter={dayLabel} tickLine={false} axisLine={false} minTickGap={12} fontSize={11} />
          <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
          <ChartTooltip cursor={{ fill: 'var(--color-tint)' }} content={<ChartTooltipContent labelFormatter={(l) => dayLabel(String(l))} />} />
          <Bar dataKey="absences" fill="var(--color-absences)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="inconsistent" fill="var(--color-inconsistent)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <Legend items={[{ label: COPY.absences, className: 'bg-chart-2' }, { label: COPY.inconsistent, className: 'bg-chart-4' }]} />
    </ChartCard>
  );
}

/** Barra segmentada de status (cores de status, cada segmento com rótulo e número ao lado). */
export function StatusBreakdown({ breakdown }: { breakdown: Overview['statusBreakdown'] }) {
  const items = [
    { key: 'calculada', label: COPY.statusOk, value: breakdown.calculada, bar: 'bg-good', dot: 'bg-good' },
    { key: 'inconsistente', label: COPY.statusInconsistent, value: breakdown.inconsistente, bar: 'bg-warn', dot: 'bg-warn' },
    { key: 'falta', label: COPY.statusAbsent, value: breakdown.falta, bar: 'bg-danger', dot: 'bg-danger' },
  ];
  const total = items.reduce((s, i) => s + i.value, 0);
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  return (
    <Card as="section" className="flex min-w-0 flex-col gap-3 p-6">
      <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.statusTitle}</h2>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface" aria-hidden>
        {items.filter((i) => i.value > 0).map((i) => <span key={i.key} className={i.bar} style={{ width: `${(i.value / total) * 100}%` }} />)}
      </div>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5"><span aria-hidden className={`h-2.5 w-2.5 rounded-full ${i.dot}`} />{i.label}</span>
            <span className="tabular-nums"><span className="font-semibold">{i.value.toLocaleString('pt-BR')}</span> <span className="text-muted">({pct(i.value)}%)</span></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Top 5 de horas extras: lista com barra proporcional ao maior (rótulo e valor em texto). */
export function TopOvertime({ top }: { top: Overview['topOvertime'] }) {
  const max = Math.max(...top.map((t) => t.overtimeMinutes), 1);
  return (
    <Card as="section" className="flex min-w-0 flex-col gap-3 p-6">
      <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.topTitle}</h2>
      {top.length === 0 ? (
        <p className="m-0 text-sm text-muted">{COPY.topNone}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
          {top.map((t) => (
            <li key={t.employeeId} className="flex flex-col gap-1">
              <span className="flex justify-between gap-2 text-sm"><span className="truncate">{t.name}</span><span className="font-semibold tabular-nums">{fmtHours(t.overtimeMinutes)}</span></span>
              <span className="h-1.5 w-full rounded-full bg-surface" aria-hidden>
                <span className="block h-full rounded-full bg-chart-4" style={{ width: `${(t.overtimeMinutes / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
