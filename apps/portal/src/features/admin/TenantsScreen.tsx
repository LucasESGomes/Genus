'use client';
/** Empresas (contas clientes): busca, filtro por situação, paginação e cadastro de empresa nova. */
import { Buildings, Plus } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { CountTabs } from '@/components/ui/CountTabs';
import { DataTable } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { QueryView } from '@/components/ui/QueryView';
import { noResultsTitle, SearchBar } from '@/components/ui/SearchBar';
import { EmptyState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Tenant, TenantStatus } from '@/lib/api/super-admin-contracts';
import { formatInstant, formatNumber } from '@/lib/format';
import { SUPER_ADMIN_EMPTY, TENANT_STATUS_LABEL } from '@/lib/labels/super-admin';
import { useScopeKey } from '@/lib/session';
import { oneOf, useUrlState } from '@/lib/url-state';
import { useTextSearch } from '@/lib/use-debounced-value';
import { COPY } from './copy';
import { useTenants } from './hooks';
import { NewTenantDialog } from './NewTenantDialog';
import { InviteLinkDialog } from '@/features/invites/InviteLinkDialog';
import type { CreatedInvite } from '@/lib/api/organization-contracts';
import type { CreatedTenant } from '@/lib/api/super-admin-contracts';

const FILTERS = ['todas', 'ativa', 'suspensa'] as const;
type Filter = (typeof FILTERS)[number];
const PAGE_SIZE = 25;

export function TenantStatusBadge({ status }: { status: TenantStatus }) {
  return <StatusBadge label={TENANT_STATUS_LABEL[status]} tone={status === 'ativa' ? 'good' : 'danger'} />;
}

export function TenantsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const scope = useScopeKey();
  const [url, setUrl] = useUrlState(['status'] as const);
  const filter = oneOf<Filter>(url.status, FILTERS, 'todas');
  const status: TenantStatus | undefined = filter === 'todas' ? undefined : filter;
  const [page, setPage] = useState(1);
  const search = useTextSearch(() => setPage(1));
  const [creating, setCreating] = useState(false);
  // A senha provisória fica só aqui, em estado de tela: nunca entra no cache de consultas.
  const [createdInvite, setCreatedInvite] = useState<CreatedInvite | null>(null);

  const query = useTenants({ ...(search.q ? { q: search.q } : {}), ...(status ? { status } : {}), page, pageSize: PAGE_SIZE });

  const columns = useMemo<ColumnDef<Tenant, never>[]>(() => {
    const c = COPY.tenants.columns;
    return [
      { id: 'name', header: c.name, cell: ({ row }) => <span className="font-semibold">{row.original.name}</span> },
      { id: 'status', header: c.status, cell: ({ row }) => <TenantStatusBadge status={row.original.status} /> },
      { id: 'employees', header: c.employees, cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.counts.employees)}</span> },
      { id: 'devices', header: c.devices, cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.counts.devices)}</span> },
      { id: 'users', header: c.users, cell: ({ row }) => <span className="tabular-nums">{formatNumber(row.original.counts.users)}</span> },
      { id: 'createdAt', header: c.createdAt, cell: ({ row }) => <span className="tabular-nums">{formatInstant(row.original.createdAt, undefined, 'dd/MM/yyyy')}</span> },
    ];
  }, []);

  const onCreated = (created: CreatedTenant) => {
    setCreatedInvite({ invite: created.invite, token: created.token });
    void qc.invalidateQueries({ queryKey: [...scope, 'admin'] });
  };

  const counts = query.data?.meta.total;
  return (
    <PageHeader
      title={COPY.tenants.title}
      subtitle={COPY.tenants.subtitle}
      primary={<Button variant="accent" icon={<Plus size={18} aria-hidden />} onClick={() => setCreating(true)}>{COPY.tenants.new}</Button>}
    >
      <CountTabs
        label={COPY.tenants.tabsLabel}
        value={filter}
        onChange={(v) => { setUrl({ status: v === 'todas' ? null : v }); setPage(1); }}
        items={FILTERS.map((f) => ({ value: f, label: COPY.tenants.tabs[f], ...(f === filter && counts !== undefined ? { count: counts } : {}) }))}
      />
      <SearchBar label={COPY.tenants.search} placeholder={COPY.tenants.searchPlaceholder} text={search.text} onTextChange={search.setText} searching={search.typing || query.isFetching} />
      <QueryView
        query={query}
        what="as empresas"
        loading={<DataTable<Tenant> caption={COPY.tenants.caption} columns={columns} data={[]} getRowId={(t) => t.id} loadingRows={5} />}
        isEmpty={(d) => d.data.length === 0}
        empty={
          search.q || status
            ? <EmptyState icon={Buildings} title={search.q ? noResultsTitle(search.q) : SUPER_ADMIN_EMPTY.tenantsSearch.title} text={SUPER_ADMIN_EMPTY.tenantsSearch.description} />
            : <EmptyState icon={Buildings} title={SUPER_ADMIN_EMPTY.tenants.title} text={SUPER_ADMIN_EMPTY.tenants.description} />
        }
      >
        {(data) => (
          <div className="flex flex-col gap-3">
            <DataTable<Tenant>
              caption={COPY.tenants.caption}
              columns={columns}
              data={data.data}
              getRowId={(t) => t.id}
              onRowClick={(t) => router.push(`/admin/empresas/${t.id}`)}
              rowLabel={(t) => COPY.tenants.rowLabel(t.name)}
            />
            <Pagination meta={data.meta} onPageChange={setPage} />
          </div>
        )}
      </QueryView>
      <NewTenantDialog open={creating} onOpenChange={setCreating} onCreated={onCreated} />
      <InviteLinkDialog created={createdInvite} onDone={() => setCreatedInvite(null)} />
    </PageHeader>
  );
}

