'use client';
/** Visão geral do painel da operação: números agregados da plataforma, uso por módulo e saúde dos sistemas. */
import { Buildings } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Card } from '@/components/ui/Card';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { StatsOverview, StatsWindow } from '@/lib/api/super-admin-contracts';
import { formatDate, formatNumber } from '@/lib/format';
import { HEALTH_SERVICE_LABEL, MODULE_USAGE_LABEL, WINDOW_LABEL } from '@/lib/labels/super-admin';
import { COPY } from './copy';
import { useHealth, useOverview } from './hooks';
import { BarChart, formatPercent, HealthBadge, HEALTH_TONE, StatCard, WindowSelect } from './parts';


function HealthStrip() {
  const health = useHealth();
  const c = COPY.overview;
  return (
    <Card as="section" className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 flex items-center gap-2 text-base font-bold">
          {c.health}
          {health.data && <HealthBadge state={health.data.status} />}
        </h2>
        <Link href="/admin/saude" className="text-sm font-semibold text-brand">{c.healthLink}</Link>
      </div>
      {health.isPending && <Skeleton className="h-6 w-full" />}
      {health.isError && !health.data && <p role="alert" className="m-0 text-sm text-danger">{c.healthError}</p>}
      {health.data && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {health.data.checks.map((k) => (
            <li key={k.service}>
              <StatusBadge label={`${HEALTH_SERVICE_LABEL[k.service]}`} tone={HEALTH_TONE[k.status]} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-4">
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}
      </div>
      <Skeleton className="h-48 rounded-card" />
    </div>
  );
}

function OverviewBody({ data }: { data: StatsOverview }) {
  const c = COPY.overview.cards;
  const maxUsage = Math.max(1, ...Object.values(data.moduleUsage));
  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label={c.tenants} value={formatNumber(data.tenants.active)} hint={c.tenantsHint(data.tenants.suspended)} />
        <StatCard label={c.employees} value={formatNumber(data.employees)} />
        <StatCard label={c.devices} value={formatNumber(data.devices.active)} hint={c.devicesHint(data.devices.total)} />
        <StatCard label={c.users} value={formatNumber(data.users)} />
        <StatCard label={c.punches} value={formatNumber(data.punches)} hint={WINDOW_LABEL[data.window]} />
        <StatCard label={c.processedRate} value={formatPercent(data.processedRate)} hint={c.processedRateHint} />
        <StatCard label={c.pendingClosings} value={formatNumber(data.pendingClosings)} />
      </div>

      <Card as="section" className="flex flex-col gap-3 p-5">
        <h2 className="m-0 text-base font-bold">{COPY.overview.perDay}</h2>
        <BarChart
          ariaLabel={`${COPY.overview.perDay}, ${WINDOW_LABEL[data.window].toLowerCase()}`}
          data={data.punchesPerDay.map((d) => ({ label: formatDate(d.day, 'dayMonth'), value: d.punches }))}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card as="section" className="flex flex-col gap-3 p-5">
          <div>
            <h2 className="m-0 text-base font-bold">{COPY.overview.modules}</h2>
            <p className="m-0 text-xs text-muted">{COPY.overview.modulesHint}</p>
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {(Object.keys(MODULE_USAGE_LABEL) as (keyof typeof MODULE_USAGE_LABEL)[]).map((k) => (
              <li key={k} className="flex flex-col gap-1">
                <div className="flex justify-between text-sm"><span>{MODULE_USAGE_LABEL[k]}</span><span className="font-semibold tabular-nums">{formatNumber(data.moduleUsage[k])}</span></div>
                <div className="h-2 rounded-full bg-surface" aria-hidden><div className="h-2 rounded-full bg-brand" style={{ width: `${(data.moduleUsage[k] / maxUsage) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card as="section" className="flex flex-col gap-3 p-5">
          <h2 className="m-0 text-base font-bold">{COPY.overview.topTenants}</h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {data.topTenants.map((t) => (
              <li key={t.tenantId} className="flex items-center justify-between gap-3 text-sm">
                <Link href={`/admin/empresas/${t.tenantId}`} className="min-w-0 truncate font-semibold text-brand">{t.name}</Link>
                <span className="shrink-0 text-muted tabular-nums">{formatNumber(t.punches)} batidas · {formatNumber(t.employees)} colab.</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}

export function OverviewScreen() {
  const [window, setWindow] = useState<StatsWindow>('24h');
  const query = useOverview(window);
  return (
    <PageHeader title={COPY.overview.title} subtitle={COPY.overview.subtitle} controls={<WindowSelect value={window} onChange={setWindow} label={COPY.overview.windowLabel} />}>
      <HealthStrip />
      <QueryView
        query={query}
        what="a visão geral"
        loading={<Loading />}
        isEmpty={(d) => d.tenants.total === 0}
        empty={<EmptyState icon={Buildings} title={COPY.overview.empty.title} text={COPY.overview.empty.text} />}
      >
        {(data) => <OverviewBody data={data} />}
      </QueryView>
    </PageHeader>
  );
}
