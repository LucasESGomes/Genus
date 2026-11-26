'use client';
/** Saúde dos sistemas (/admin/saude): estado de cada serviço, atualizado a cada 15 s enquanto a aba está visível. */
import { ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import type { HealthCheck, HealthState, SystemHealth } from '@/lib/api/super-admin-contracts';
import { useClock } from '@/lib/clock-context';
import { formatInstant, formatNumber } from '@/lib/format';
import { HEALTH_SERVICE_LABEL, HEALTH_STATE_LABEL } from '@/lib/labels/super-admin';
import { useHealth } from './hooks';
import { HealthBadge } from './parts';

const METRIC_LABEL: Record<string, string> = {
  connections: 'Conexões',
  punches: 'Fila de batidas',
  postPunch: 'Fila pós-batida',
  galleryCached: 'Galerias em cache',
  pendingPunches: 'Batidas pendentes',
  pendingOutbox: 'Eventos pendentes',
};

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d} d ${h} h ${m} min`;
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

export function formatAgo(seconds: number): string {
  if (seconds < 5) return 'agora há pouco';
  if (seconds < 60) return `há ${seconds} s`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h`;
}

const BANNER: Record<HealthState, string> = {
  ok: 'border-good-line bg-good-bg text-good',
  degraded: 'border-warn-line bg-warn-bg text-warn',
  down: 'border-danger-line bg-danger-bg text-danger',
};
const BANNER_TEXT: Record<HealthState, string> = {
  ok: 'Todos os sistemas operando.',
  degraded: 'Há sistemas degradados. Veja abaixo qual.',
  down: 'Há sistemas fora do ar. Veja abaixo qual.',
};

function ServiceCard({ check }: { check: HealthCheck }) {
  const metrics = check.metrics ? Object.entries(check.metrics) : [];
  return (
    <Card as="section" className="flex flex-col gap-2 p-5">
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 text-base font-bold">{HEALTH_SERVICE_LABEL[check.service]}</h2>
        <HealthBadge state={check.status} />
      </div>
      <p className="m-0 text-sm text-muted tabular-nums">Latência: {check.latencyMs === null ? '—' : `${formatNumber(check.latencyMs)} ms`}</p>
      {check.detail && <p className="m-0 text-sm">{check.detail}</p>}
      {metrics.length > 0 && (
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          {metrics.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{METRIC_LABEL[k] ?? k}</dt>
              <dd className="m-0 font-semibold tabular-nums">{formatNumber(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
      {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28 rounded-card" />)}
    </div>
  );
}

function Body({ data }: { data: SystemHealth }) {
  const clock = useClock();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const ago = Math.max(0, Math.round((clock.now().getTime() - Date.parse(data.checkedAt)) / 1000));
  return (
    <>
      <div role="status" className={`flex flex-wrap items-center gap-3 rounded-card border px-5 py-4 ${BANNER[data.status]}`}>
        <HealthBadge state={data.status} />
        <span className="font-semibold">{BANNER_TEXT[data.status]}</span>
        <span className="sr-only">Situação geral: {HEALTH_STATE_LABEL[data.status]}</span>
      </div>
      <p className="m-0 text-sm text-muted tabular-nums">
        Verificado em {formatInstant(data.checkedAt)} ({formatAgo(ago)}) · versão {data.version} · no ar há {formatUptime(data.uptimeSeconds)}
      </p>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {data.checks.map((c) => <ServiceCard key={c.service} check={c} />)}
      </div>
    </>
  );
}

export function HealthScreen() {
  // useHealth atualiza a cada 15 s e pausa com a aba em segundo plano (refetchIntervalInBackground é falso por padrão).
  const query = useHealth();
  return (
    <PageHeader
      title="Saúde dos sistemas"
      subtitle="Atualiza sozinha a cada 15 segundos enquanto esta aba estiver aberta."
      controls={<Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()} icon={<ArrowClockwise size={18} aria-hidden />}>Atualizar agora</Button>}
    >
      <QueryView query={query} what="a saúde dos sistemas" loading={<Loading />}>
        {(data) => <Body data={data} />}
      </QueryView>
    </PageHeader>
  );
}
