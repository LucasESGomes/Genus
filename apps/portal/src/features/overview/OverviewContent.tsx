'use client';
import { ChartLine } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/shell/PageHeader';
import { useHeaderPeriod } from '@/components/shell/useHeaderPeriod';
import { AlertCard } from '@/components/ui/AlertCard';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { KpiCard } from '@/components/ui/KpiCard';
import { ComingSoonState, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/components/ui/States';
import { can } from '@/lib/auth/permissions';
import { isHiddenResource } from '@/lib/api/errors';
import { formatPeriod } from '@/lib/format';
import { useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { ALERT_ROUTE, COPY } from './copy';
import { FeaturedKpiCard } from './FeaturedKpiCard';

/**
 * Visão geral do RH: KPIs e alertas vêm prontos da api. O front não recalcula nada.
 * O período (URL `from`/`to`) entra na chave de cache e a tela busca de novo ao mudar.
 * [MOCK] GET /portal/overview ainda ignora o período; quando o back existir, ele passa a filtrar.
 */
export function OverviewContent() {
  const { me, establishment } = useSession();
  const router = useRouter();
  const { period, setPeriod } = useHeaderPeriod();
  const allowed = can(me.role, 'nav.overview');
  const q = useApiQuery(
    'overview',
    { establishmentId: establishment.id, from: period.from, to: period.to },
    (api, signal) => api.overview.get(establishment.id, signal),
    { enabled: allowed },
  );

  const forbidden = (
    <PageHeader title={COPY.title}><ForbiddenState screen={COPY.title} establishment={establishment.name} /></PageHeader>
  );
  if (!allowed) return forbidden;

  const header = {
    title: COPY.title,
    subtitle: `${formatPeriod(period.from, period.to)} · America/Sao_Paulo`,
    primary: <Button variant="accent" onClick={() => router.push(ALERT_ROUTE.apuracao)}>{COPY.primary}</Button>,
    periodValue: period,
    onPeriodChange: setPeriod,
  };

  if (q.isPending) return <PageHeader {...header}><LoadingState label={`Carregando dados de ${establishment.name}…`} /></PageHeader>;
  if (q.isError) {
    if (isHiddenResource(q.error)) return forbidden;
    if (q.error.kind === 'unavailable') return <PageHeader title={COPY.title}><ComingSoonState what="a visão geral" /></PageHeader>;
    return (
      <PageHeader {...header}>
        <ErrorState what="a visão geral" code={`Erro ${q.error.status || '—'} · ${q.error.code}`} onRetry={() => void q.refetch()} />
      </PageHeader>
    );
  }

  const { kpis, alerts } = q.data;
  if (kpis.length === 0 && alerts.length === 0) {
    return (
      <PageHeader {...header}>
        <EmptyState icon={ChartLine} title="Ainda não há dados neste período" text={`Nenhuma marcação foi apurada em ${establishment.name} no período escolhido.`} />
      </PageHeader>
    );
  }
  return (
    <PageHeader {...header}>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
        {kpis.map((k) => (k.key === 'workedHours' ? <FeaturedKpiCard key={k.key} kpi={k} /> : <KpiCard key={k.key} kpi={k} />))}
      </div>
      <div className="flex flex-wrap items-stretch gap-4">
        <Card as="section" className="flex min-w-0 flex-[2_1_560px] flex-col gap-3 p-6">
          <div>
            <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.chartTitle}</h2>
            <p className="m-0 text-xs text-muted">{COPY.chartHint}</p>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-10 text-center">
            <ChartLine size={28} className="text-muted" aria-hidden />
            <p className="m-0 font-semibold">{COPY.chartUnavailable}</p>
            <p className="m-0 max-w-[420px] text-sm text-muted text-pretty">{COPY.chartUnavailableText}</p>
          </div>
        </Card>
        <Card as="section" className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 p-6">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.alertsTitle}</h2>
            <span className="text-xs font-semibold text-muted tabular-nums">{alerts.length} {alerts.length === 1 ? 'aberto' : 'abertos'}</span>
          </div>
          {alerts.map((a) => <AlertCard key={a.id} alert={a} onAction={() => router.push(ALERT_ROUTE[a.target])} />)}
        </Card>
      </div>
    </PageHeader>
  );
}
