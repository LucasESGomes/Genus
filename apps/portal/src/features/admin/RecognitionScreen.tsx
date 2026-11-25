'use client';
/** Reconhecimento (/admin/reconhecimento): só agregados de arp.entradas. Nunca batida individual nem dado de colaborador (04 §1.4). */
import { Fingerprint } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import type { RecognitionDevice, RecognitionQuery, RecognitionSeriesPoint, RecognitionSummary, ScoreStats, StatsWindow } from '@/lib/api/super-admin-contracts';
import { formatInstant, formatNumber } from '@/lib/format';
import { RECOGNITION_UNAVAILABLE_TEXT, SUPER_ADMIN_EMPTY, WINDOW_LABEL } from '@/lib/labels/super-admin';
import { oneOf, useUrlState } from '@/lib/url-state';
import { digitsOnly, FilterBar, NativeSelect, TableSkeleton, UrlTextInput } from './audit-parts';
import { useRecognitionDevices, useRecognitionSeries, useRecognitionSummary, useTenantOptions } from './hooks-ops';
import { BarChart, StatCard, WindowSelect } from './parts';

const WINDOWS: readonly StatsWindow[] = ['24h', '7d', '30d'];
const KEYS = ['janela', 'conta', 'estabelecimento', 'aparelho'] as const;

const score = (v: number | null) => (v === null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const scoreHint = (s: ScoreStats) => `Mediana (p50) ${score(s.p50)} · Pior 5% (p05) ${score(s.p05)}`;
const BIN_LABELS = Array.from({ length: 10 }, (_, i) => `${(i / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}–${((i + 1) / 10).toLocaleString('pt-BR', { minimumFractionDigits: 1 })}`);

const UNAVAILABLE: { label: string }[] = [
  { label: 'Não reconhecidos' },
  { label: 'Vivacidade reprovada' },
  { label: 'Latência p50' },
  { label: 'Latência p95' },
];

function Cards({ data }: { data: RecognitionSummary }) {
  return (
    <>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="Batidas" value={formatNumber(data.punches)} hint={WINDOW_LABEL[data.window]} />
        <StatCard label="Processadas" value={formatNumber(data.byStatus.processado)} />
        <StatCard label="Pendentes" value={formatNumber(data.byStatus.pendente)} />
        <StatCard label="Com falha" value={formatNumber(data.byStatus.falhou)} />
        <StatCard label="Relógio divergente" value={formatNumber(data.divergentClock)} hint="Hora do aparelho diferente da do servidor" />
        <StatCard label="Nota de reconhecimento (média)" value={score(data.recognitionScore.avg)} hint={scoreHint(data.recognitionScore)} />
        <StatCard label="Nota de vivacidade (média)" value={score(data.livenessScore.avg)} hint={scoreHint(data.livenessScore)} />
      </div>
      <section aria-labelledby="rec-unavailable" className="flex flex-col gap-2">
        <h2 id="rec-unavailable" className="m-0 text-base font-bold">Métricas que dependem do coletor</h2>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
          {UNAVAILABLE.map((u) => <StatCard key={u.label} label={u.label} value="—" hint={RECOGNITION_UNAVAILABLE_TEXT} />)}
        </div>
      </section>
      <Card as="section" className="flex flex-col gap-3 p-5">
        <div>
          <h2 className="m-0 text-base font-bold">Distribuição da nota de vivacidade</h2>
          <p className="m-0 text-xs text-muted">Quantidade de batidas em cada faixa de 0,1, de 0,0 a 1,0.</p>
        </div>
        <BarChart ariaLabel="Histograma da nota de vivacidade" valueLabel="Batidas" data={data.livenessHistogram.map((value, i) => ({ label: BIN_LABELS[i] ?? String(i), value }))} />
      </Card>
    </>
  );
}

function SeriesCard({ query }: { query: RecognitionQuery & { bucket: 'hour' | 'day' } }) {
  const series = useRecognitionSeries(query);
  const label = (p: RecognitionSeriesPoint) => formatInstant(p.bucketStart, undefined, query.bucket === 'hour' ? "dd/MM HH'h'" : 'dd/MM');
  return (
    <Card as="section" className="flex flex-col gap-3 p-5">
      <h2 className="m-0 text-base font-bold">{query.bucket === 'hour' ? 'Batidas e falhas por hora' : 'Batidas e falhas por dia'}</h2>
      <QueryView
        query={series}
        what="a série de batidas"
        loading={<Skeleton className="h-40 w-full" />}
        isEmpty={(d) => d.length === 0}
        empty={<p className="m-0 text-sm text-muted">{SUPER_ADMIN_EMPTY.recognition.description}</p>}
      >
        {(points) => (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="m-0 mb-1 text-sm font-semibold">Batidas</h3>
              <BarChart ariaLabel="Batidas no período" valueLabel="Batidas" data={points.map((p) => ({ label: label(p), value: p.punches }))} />
            </div>
            <div>
              <h3 className="m-0 mb-1 text-sm font-semibold">Falhas</h3>
              <BarChart ariaLabel="Falhas no período" valueLabel="Falhas" data={points.map((p) => ({ label: label(p), value: p.failed }))} />
            </div>
          </div>
        )}
      </QueryView>
    </Card>
  );
}

function DevicesCard({ query }: { query: RecognitionQuery }) {
  const devices = useRecognitionDevices(query);
  const columns = useMemo<ColumnDef<RecognitionDevice, never>[]>(() => [
    { id: 'tenant', header: 'Conta', cell: ({ row }) => <span className="tabular-nums">#{row.original.tenantId}</span> },
    { id: 'establishment', header: 'Estabelecimento', cell: ({ row }) => <span className="tabular-nums">#{row.original.establishmentId}</span> },
    { id: 'device', header: 'Aparelho', cell: ({ row }) => <span className="font-semibold">{row.original.deviceName ?? `#${row.original.deviceId}`}</span> },
    { id: 'punches', header: 'Batidas', cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.punches)}</span> },
    { id: 'failed', header: 'Falhas', cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.failed)}</span> },
    { id: 'divergent', header: 'Divergentes', cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.divergentClock)}</span> },
    { id: 'recognition', header: 'Nota de reconhecimento', cell: ({ row }) => <span className="tabular-nums">{score(row.original.avgRecognitionScore)}</span> },
    { id: 'liveness', header: 'Nota de vivacidade', cell: ({ row }) => <span className="tabular-nums">{score(row.original.avgLivenessScore)}</span> },
    { id: 'last', header: 'Última batida', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{row.original.lastPunchAt ? formatInstant(row.original.lastPunchAt) : '—'}</span> },
  ], []);
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-base font-bold">Aparelhos</h2>
      <QueryView
        query={devices}
        what="os aparelhos"
        loading={<TableSkeleton rows={4} />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={Fingerprint} title={SUPER_ADMIN_EMPTY.recognitionDevices.title} text={SUPER_ADMIN_EMPTY.recognitionDevices.description} />}
      >
        {(data) => <DataTable<RecognitionDevice> caption="Reconhecimento por aparelho" columns={columns} data={data} getRowId={(d) => `${d.tenantId}-${d.establishmentId}-${d.deviceId}`} />}
      </QueryView>
    </section>
  );
}

export function RecognitionScreen() {
  const [url, setUrl] = useUrlState(KEYS);
  const window = oneOf<StatsWindow>(url.janela, WINDOWS, '24h');
  const tenants = useTenantOptions();
  const q: RecognitionQuery = {
    window,
    ...(url.conta ? { tenantId: url.conta } : {}),
    ...(url.estabelecimento ? { establishmentId: url.estabelecimento } : {}),
    ...(url.aparelho ? { deviceId: url.aparelho } : {}),
  };
  const summary = useRecognitionSummary(q);
  return (
    <PageHeader
      title="Reconhecimento"
      subtitle="Só agregados: o painel não mostra batidas individuais nem dados de colaboradores (04 §1.4)."
      controls={<WindowSelect value={window} onChange={(w) => setUrl({ janela: w === '24h' ? null : w })} />}
    >
      <FilterBar label="Filtros do reconhecimento">
        <NativeSelect label="Conta" value={url.conta ?? ''} onChange={(v) => setUrl({ conta: v })} options={(tenants.data?.data ?? []).map((t) => ({ value: t.id, label: t.name }))} allLabel="Todas as contas" />
        <UrlTextInput label="ID do estabelecimento" value={url.estabelecimento ?? ''} onCommit={(v) => setUrl({ estabelecimento: v })} inputMode="numeric" sanitize={digitsOnly} />
        <UrlTextInput label="ID do aparelho" value={url.aparelho ?? ''} onCommit={(v) => setUrl({ aparelho: v })} inputMode="numeric" sanitize={digitsOnly} />
      </FilterBar>
      <QueryView
        query={summary}
        what="o reconhecimento"
        loading={<div aria-busy="true" aria-label="Carregando" className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24 rounded-card" />)}</div>}
        isEmpty={(d) => d.punches === 0}
        empty={<EmptyState icon={Fingerprint} title={SUPER_ADMIN_EMPTY.recognition.title} text={SUPER_ADMIN_EMPTY.recognition.description} />}
      >
        {(data) => (
          <>
            <Cards data={data} />
            <SeriesCard query={{ ...q, bucket: window === '24h' ? 'hour' : 'day' }} />
            <DevicesCard query={q} />
          </>
        )}
      </QueryView>
    </PageHeader>
  );
}
