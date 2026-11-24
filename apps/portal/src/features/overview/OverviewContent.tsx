'use client';
import { ChartLine } from '@phosphor-icons/react';
import { AlertCard } from '@/components/ui/AlertCard';
import { Card } from '@/components/ui/Card';
import { KpiCard } from '@/components/ui/KpiCard';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/components/ui/States';
import { can } from '@/lib/auth/permissions';
import { useResource } from '@/lib/use-resource';
import { useSession } from '@/lib/session';

/** Visão geral do RH: KPIs e alertas vêm prontos da api. O front não recalcula nada. */
export function OverviewContent() {
  const { me, api, establishment } = useSession();
  const { state, retry } = useResource((signal) => api.overview(establishment.id, signal), [establishment.id]);

  if (!can(me.role, 'rh.panel')) return <ForbiddenState screen="Visão geral" establishment={establishment.name} />;
  if (state.status === 'loading') return <LoadingState label={`Carregando dados de ${establishment.name}…`} />;
  if (state.status === 'error') {
    if (state.error.kind === 'forbidden') return <ForbiddenState screen="Visão geral" establishment={establishment.name} />;
    return <ErrorState what="a visão geral" code={`Erro ${state.error.status || '—'} · ${state.error.code}`} onRetry={retry} />;
  }
  const { kpis, alerts } = state.data;
  if (kpis.length === 0 && alerts.length === 0) {
    return <EmptyState icon={ChartLine} title="Ainda não há dados neste período" text={`Nenhuma marcação foi apurada em ${establishment.name} no período escolhido.`} />;
  }
  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
      </div>
      <div className="flex flex-wrap items-stretch gap-4">
        <Card as="section" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-md font-bold tracking-[-0.01em]">Alertas de inconsistência</h2>
            <span className="text-xs font-semibold text-muted tabular-nums">{alerts.length} {alerts.length === 1 ? 'aberto' : 'abertos'}</span>
          </div>
          {alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
        </Card>
      </div>
    </>
  );
}
