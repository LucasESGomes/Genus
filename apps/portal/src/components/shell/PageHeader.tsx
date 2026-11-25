/**
 * Cabeçalho de página do painel: título, subtítulo, período, controles (ex.: filtros) e UMA ação primária.
 * A ação primária usa o botão de destaque (fundo accent, texto on-accent): só uma por tela.
 * O período vem de `useHeaderPeriod()` (URL `from`/`to`): passe `periodValue` e `onPeriodChange`.
 */
import type { ReactNode } from 'react';
import { PeriodPicker, type Period, type PeriodPreset } from '@/components/ui/PeriodPicker';

export function PageHeader({ title, subtitle, controls, primary, periodValue, onPeriodChange, periodPresets, children }: {
  title: string;
  subtitle?: ReactNode;
  /** Filtros ao lado da ação primária. */
  controls?: ReactNode;
  /** A ação principal da tela (um <Button variant="accent">). */
  primary?: ReactNode;
  /** Período exibido no seletor do cabeçalho (use junto com `onPeriodChange`). */
  periodValue?: Period;
  onPeriodChange?: (period: Period) => void;
  periodPresets?: PeriodPreset[];
  /** Conteúdo da página, já com o espaçamento do design. */
  children: ReactNode;
}) {
  const hasPeriod = periodValue !== undefined && onPeriodChange !== undefined;
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 px-4 pt-5 pb-4 md:px-8 md:pt-7 md:pb-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="m-0 text-2xl font-bold tracking-[-0.02em]">{title}</h1>
          {subtitle && <div className="text-muted tabular-nums">{subtitle}</div>}
        </div>
        {(hasPeriod || controls || primary) && (
          <div className="flex flex-wrap items-end gap-3">
            {hasPeriod && <PeriodPicker value={periodValue} onChange={onPeriodChange} presets={periodPresets} />}
            {controls}
            {primary}
          </div>
        )}
      </header>
      <div className="flex flex-col gap-4 px-4 pb-28 md:px-8">{children}</div>
    </>
  );
}
