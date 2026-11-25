'use client';
/** Acessos e IPs (/admin/acessos): sessões (com revogação), tentativas de login e IPs sinalizados. Só sinaliza, nunca bloqueia. */
import { Globe, ShieldWarning, UsersThree } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { DateInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { Pagination } from '@/components/ui/Pagination';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { FlaggedIp, LoginAttempt, PortalSession, StatsWindow } from '@/lib/api/super-admin-contracts';
import { formatInstant, formatNumber } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';
import { IP_FLAG_REASON_LABEL, LOGIN_FAILURE_LABEL, LOGIN_STEP_LABEL, SUPER_ADMIN_EMPTY } from '@/lib/labels/super-admin';
import { oneOf, useUrlState } from '@/lib/url-state';
import { describeUserAgent } from './access-parts';
import { digitsOnly, FilterBar, InfiniteView, NativeSelect, rangeToIso, RangeError, TableSkeleton, UrlTextInput } from './audit-parts';
import { useFlaggedIps, useLoginAttempts, useRevokeSession, useRevokeUserSessions, useSessions, useTenantOptions } from './hooks-ops';
import { friendlyError, WindowSelect } from './parts';
import type { Role } from '@/lib/api/contracts';

const TABS = ['sessoes', 'tentativas', 'ips'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { sessoes: 'Sessões', tentativas: 'Tentativas de login', ips: 'IPs sinalizados' };
const WINDOWS: readonly StatsWindow[] = ['24h', '7d', '30d'];
const KEYS = ['aba', 'conta', 'usuario', 'ip', 'ativas', 'resultado', 'de', 'ate', 'janela'] as const;
type Url = ReturnType<typeof useUrlState<(typeof KEYS)[number]>>[0];
type SetUrl = ReturnType<typeof useUrlState<(typeof KEYS)[number]>>[1];

const IP_HINT = 'Endereço IP, igual ao que aparece na tabela.';
const roleLabel = (r: string) => (Object.hasOwn(ROLE_LABEL, r) ? ROLE_LABEL[r as Role] : r);
const when = (iso: string) => <span className="whitespace-nowrap tabular-nums">{formatInstant(iso)}</span>;

type Revoke = { kind: 'session'; session: PortalSession } | { kind: 'user'; session: PortalSession };

function SessionsPanel({ url, setUrl, onResult }: { url: Url; setUrl: SetUrl; onResult: (m: string) => void }) {
  const tenants = useTenantOptions();
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Revoke | null>(null);
  const revokeSession = useRevokeSession();
  const revokeUser = useRevokeUserSessions();
  const filter = (patch: Partial<Record<(typeof KEYS)[number], string | null>>) => { setUrl(patch); setPage(1); };
  const query = useSessions({
    ...(url.conta ? { tenantId: url.conta } : {}),
    ...(url.usuario ? { userId: url.usuario } : {}),
    ...(url.ip ? { ip: url.ip } : {}),
    ...(url.ativas === '1' ? { active: true } : {}),
    page,
    pageSize: 25,
  });

  const columns = useMemo<ColumnDef<PortalSession, never>[]>(() => [
    { id: 'user', header: 'Usuário', cell: ({ row }) => <span className="font-semibold">{row.original.userEmail}</span> },
    { id: 'role', header: 'Papel', cell: ({ row }) => roleLabel(row.original.role) },
    { id: 'tenant', header: 'Conta', cell: ({ row }) => row.original.tenantName ?? '—' },
    { id: 'ip', header: 'IP', cell: ({ row }) => <span className="tabular-nums">{row.original.ipAddress ?? '—'}</span> },
    { id: 'ua', header: 'Navegador', cell: ({ row }) => <span title={row.original.userAgent ?? undefined}>{describeUserAgent(row.original.userAgent)}</span> },
    { id: 'createdAt', header: 'Criada', cell: ({ row }) => when(row.original.createdAt) },
    { id: 'expiresAt', header: 'Expira', cell: ({ row }) => when(row.original.expiresAt) },
    { id: 'status', header: 'Situação', cell: ({ row }) => <StatusBadge label={row.original.isActive ? 'Ativa' : 'Encerrada'} tone={row.original.isActive ? 'good' : 'neutral'} /> },
    {
      id: 'actions',
      header: () => <span className="sr-only">Ações</span>,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!row.original.isActive} aria-label={`Revogar sessão de ${row.original.userEmail} (${row.original.id})`} onClick={() => setPending({ kind: 'session', session: row.original })}>
            Revogar sessão
          </Button>
          <Button variant="secondary" size="sm" aria-label={`Revogar todas as sessões de ${row.original.userEmail}`} onClick={() => setPending({ kind: 'user', session: row.original })}>
            Revogar todas do usuário
          </Button>
        </div>
      ),
    },
  ], []);

  const confirm = async (reason?: string) => {
    if (!pending || !reason) return;
    try {
      const r = pending.kind === 'session'
        ? await revokeSession.mutateAsync({ id: pending.session.id, reason })
        : await revokeUser.mutateAsync({ userId: pending.session.userId, reason });
      const message = r.revoked === 1 ? '1 sessão revogada.' : `${formatNumber(r.revoked)} sessões revogadas.`;
      onResult(message);
      notify.success(message);
    } catch (e) {
      throw friendlyError(e);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FilterBar label="Filtros das sessões">
        <NativeSelect label="Conta" value={url.conta ?? ''} onChange={(v) => filter({ conta: v })} options={(tenants.data?.data ?? []).map((t) => ({ value: t.id, label: t.name }))} allLabel="Todas as contas" />
        <UrlTextInput label="ID do usuário" value={url.usuario ?? ''} onCommit={(v) => filter({ usuario: v })} inputMode="numeric" sanitize={digitsOnly} />
        <UrlTextInput label="IP" value={url.ip ?? ''} onCommit={(v) => filter({ ip: v })} hint={IP_HINT} />
        <NativeSelect label="Situação" value={url.ativas === '1' ? '1' : ''} onChange={(v) => filter({ ativas: v })} options={[{ value: '1', label: 'Só as ativas' }]} allLabel="Todas" />
      </FilterBar>
      <QueryView
        query={query}
        what="as sessões"
        loading={<TableSkeleton />}
        isEmpty={(d) => d.data.length === 0}
        empty={<EmptyState icon={UsersThree} title={SUPER_ADMIN_EMPTY.sessions.title} text={SUPER_ADMIN_EMPTY.sessions.description} />}
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            <DataTable<PortalSession> caption="Sessões" columns={columns} data={data.data} getRowId={(s) => s.id} />
            <Pagination meta={data.meta} onPageChange={setPage} />
          </div>
        )}
      </QueryView>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => { if (!o) setPending(null); }}
        title={pending?.kind === 'user' ? 'Revogar todas as sessões do usuário' : 'Revogar sessão'}
        description={pending ? (pending.kind === 'user'
          ? `Todas as sessões de ${pending.session.userEmail} serão encerradas e a pessoa terá de entrar de novo.`
          : `A sessão de ${pending.session.userEmail} (${pending.session.ipAddress ?? 'IP desconhecido'}) será encerrada.`) : ''}
        confirmLabel="Revogar"
        tone="danger"
        reason={{ label: 'Motivo', min: 3, max: 500 }}
        onConfirm={confirm}
      />
    </div>
  );
}

function AttemptsPanel({ url, setUrl }: { url: Url; setUrl: SetUrl }) {
  const tenants = useTenantOptions();
  const range = rangeToIso(url.de ?? '', url.ate ?? '');
  const result = oneOf(url.resultado, ['', 'sucesso', 'falha'] as const, '');
  const query = useLoginAttempts(
    {
      ...(url.ip ? { ip: url.ip } : {}),
      ...(url.conta ? { tenantId: url.conta } : {}),
      ...(result ? { success: result === 'sucesso' } : {}),
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
    },
    !range.error,
  );
  const columns = useMemo<ColumnDef<LoginAttempt, never>[]>(() => [
    { id: 'createdAt', header: 'Quando', cell: ({ row }) => when(row.original.createdAt) },
    { id: 'ip', header: 'IP', cell: ({ row }) => <span className="tabular-nums">{row.original.ipAddress ?? '—'}</span> },
    { id: 'step', header: 'Etapa', cell: ({ row }) => LOGIN_STEP_LABEL[row.original.step] },
    { id: 'result', header: 'Resultado', cell: ({ row }) => <StatusBadge label={row.original.success ? 'Sucesso' : 'Falha'} tone={row.original.success ? 'good' : 'danger'} /> },
    { id: 'reason', header: 'Motivo', cell: ({ row }) => (row.original.failureReason ? LOGIN_FAILURE_LABEL[row.original.failureReason] : '—') },
  ], []);
  return (
    <div className="flex flex-col gap-4">
      <FilterBar label="Filtros das tentativas de login">
        <UrlTextInput label="IP" value={url.ip ?? ''} onCommit={(v) => setUrl({ ip: v })} hint={IP_HINT} />
        <NativeSelect label="Conta" value={url.conta ?? ''} onChange={(v) => setUrl({ conta: v })} options={(tenants.data?.data ?? []).map((t) => ({ value: t.id, label: t.name }))} allLabel="Todas as contas" />
        <NativeSelect label="Resultado" value={result} onChange={(v) => setUrl({ resultado: v })} options={[{ value: 'sucesso', label: 'Sucesso' }, { value: 'falha', label: 'Falha' }]} allLabel="Todos" />
        <DateInput label="De" value={url.de ?? ''} onChange={(e) => setUrl({ de: e.target.value })} />
        <DateInput label="Até" value={url.ate ?? ''} onChange={(e) => setUrl({ ate: e.target.value })} />
      </FilterBar>
      {range.error && <RangeError message={range.error} />}
      <InfiniteView query={query} what="as tentativas de login" empty={SUPER_ADMIN_EMPTY.loginAttempts} emptyIcon={Globe}>
        {(rows) => <DataTable<LoginAttempt> caption="Tentativas de login" columns={columns} data={rows} getRowId={(a) => a.id} />}
      </InfiniteView>
    </div>
  );
}

function FlaggedPanel({ url, setUrl }: { url: Url; setUrl: SetUrl }) {
  const window = oneOf<StatsWindow>(url.janela, WINDOWS, '24h');
  const query = useFlaggedIps(window);
  const columns = useMemo<ColumnDef<FlaggedIp, never>[]>(() => [
    {
      id: 'ip',
      header: 'IP',
      cell: ({ row }) => (
        <button
          type="button"
          aria-label={`Ver tentativas do IP ${row.original.ipAddress}`}
          className="cursor-pointer border-0 bg-transparent p-0 font-semibold tabular-nums text-brand underline"
          onClick={() => setUrl({ aba: 'tentativas', ip: row.original.ipAddress })}
        >
          {row.original.ipAddress}
        </button>
      ),
    },
    { id: 'flag', header: 'Situação', cell: ({ row }) => <StatusBadge label={row.original.flagged ? 'Sinalizado' : 'Sem sinal'} tone={row.original.flagged ? 'warn' : 'neutral'} /> },
    { id: 'reasons', header: 'Motivos', cell: ({ row }) => (row.original.reasons.length ? row.original.reasons.map((r) => IP_FLAG_REASON_LABEL[r]).join(', ') : '—') },
    { id: 'failures', header: 'Falhas', cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.failures)}</span> },
    { id: 'successes', header: 'Sucessos', cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.successes)}</span> },
    { id: 'accounts', header: 'Contas distintas', cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.distinctAccounts)}</span> },
    { id: 'first', header: 'Primeira vez', cell: ({ row }) => when(row.original.firstSeenAt) },
    { id: 'last', header: 'Última vez', cell: ({ row }) => when(row.original.lastSeenAt) },
  ], [setUrl]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-[60ch] text-sm text-muted">O painel só sinaliza endereços suspeitos: nenhum IP é bloqueado e ninguém perde o acesso por causa disto.</p>
        <WindowSelect value={window} onChange={(w) => setUrl({ janela: w === '24h' ? null : w })} label="Período dos IPs" />
      </div>
      <QueryView
        query={query}
        what="os IPs sinalizados"
        loading={<TableSkeleton />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={ShieldWarning} title={SUPER_ADMIN_EMPTY.flaggedIps.title} text={SUPER_ADMIN_EMPTY.flaggedIps.description} />}
      >
        {(data) => <DataTable<FlaggedIp> caption="IPs sinalizados" columns={columns} data={data} getRowId={(f) => f.ipAddress} />}
      </QueryView>
    </div>
  );
}

export function AccessScreen() {
  const [url, setUrl] = useUrlState(KEYS);
  const tab = oneOf<Tab>(url.aba, TABS, 'sessoes');
  const [message, setMessage] = useState<string | null>(null);
  return (
    <PageHeader title="Acessos e IPs" subtitle="Quem entrou, de onde e quantas vezes errou. Sessões podem ser revogadas com motivo.">
      <CountTabs label="Seções de acessos" value={tab} onChange={(v) => setUrl({ aba: v === 'sessoes' ? null : v })} items={TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))} />
      <div role="status" aria-live="polite" className={message ? 'rounded-md border border-line bg-good-bg px-3 py-2 text-sm font-medium text-good' : 'sr-only'}>{message}</div>
      <div role="tabpanel" aria-label={TAB_LABEL[tab]} className="flex flex-col gap-4">
        {tab === 'sessoes' && <SessionsPanel url={url} setUrl={setUrl} onResult={setMessage} />}
        {tab === 'tentativas' && <AttemptsPanel url={url} setUrl={setUrl} />}
        {tab === 'ips' && <FlaggedPanel url={url} setUrl={setUrl} />}
      </div>
    </PageHeader>
  );
}
