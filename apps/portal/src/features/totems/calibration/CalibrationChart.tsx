'use client';
// Reescrito com recharts (shadcn chart) a partir de visage/frontend/src/components/app/RecognitionDistanceChart.tsx (fonte somente leitura)
//
// Mostra as distâncias já agregadas em faixas (mesma pessoa x pessoas diferentes) e marca o limiar atual e o proposto.
// Nenhuma imagem nem embedding chega aqui. O gráfico é decorativo para leitor de tela: o resumo vem em texto.
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/shadcn/chart';
import type { CalibrationSessionResult } from '@/lib/api/contracts';
import { COPY } from '../copy';

const config: ChartConfig = {
  genuine: { label: COPY.calibration.genuine, color: 'var(--color-chart-2)' },
  impostor: { label: COPY.calibration.impostor, color: 'var(--color-chart-4)' },
};

const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CalibrationChart({ result }: { result: CalibrationSessionResult }) {
  const { current, proposed, distanceHistogram: data } = result;
  const summary = `${COPY.calibration.chartTitle}: limiar atual ${fmt(current.recognitionThreshold)} e proposto ${fmt(proposed.recognitionThreshold)}.`;
  return (
    <figure className="m-0 flex flex-col gap-2">
      <figcaption className="text-sm font-semibold">{COPY.calibration.chartTitle}</figcaption>
      <p className="m-0 text-xs text-muted">{COPY.calibration.chartHint}</p>
      <p className="sr-only">{summary}</p>
      <div aria-hidden>
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <AreaChart data={data} margin={{ top: 18, right: 12, bottom: 4, left: 0 }} accessibilityLayer={false}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="bucket" type="number" domain={['dataMin', 'dataMax']} tickFormatter={fmt} tickLine={false} />
            <YAxis width={32} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(_l, p) => `Distância ${fmt(Number(p[0]?.payload?.bucket ?? 0))}`} />} />
            <Area dataKey="genuine" type="monotone" stroke="var(--color-genuine)" fill="var(--color-genuine)" fillOpacity={0.25} isAnimationActive={false} />
            <Area dataKey="impostor" type="monotone" stroke="var(--color-impostor)" fill="var(--color-impostor)" fillOpacity={0.25} isAnimationActive={false} />
            <ReferenceLine x={current.recognitionThreshold} stroke="var(--color-muted)" strokeDasharray="4 4" label={{ value: COPY.calibration.thresholdCurrent, position: 'insideTopLeft', fontSize: 11 }} />
            <ReferenceLine x={proposed.recognitionThreshold} stroke="var(--color-brand)" strokeWidth={2} label={{ value: COPY.calibration.thresholdProposed, position: 'insideTopRight', fontSize: 11 }} />
          </AreaChart>
        </ChartContainer>
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-4 p-0 text-xs text-ink-2">
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-chart-2" />{COPY.calibration.genuine}</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-chart-4" />{COPY.calibration.impostor}</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-2 border-dashed border-muted" />{COPY.calibration.thresholdCurrent} {fmt(current.recognitionThreshold)}</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="h-0 w-4 border-t-2 border-brand" />{COPY.calibration.thresholdProposed} {fmt(proposed.recognitionThreshold)}</li>
      </ul>
    </figure>
  );
}
