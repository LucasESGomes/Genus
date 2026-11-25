'use client';
/** Auditoria (/admin/auditoria): leituras e escritas do painel e das contas, com filtros na URL e paginação por cursor. */
import { ClipboardText } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { DateInput } from '@/components/ui/Fields';
import type { AuditAction, AuditLog } from '@/lib/api/super-admin-contracts';
import { formatInstant } from '@/lib/format';
import { AUDIT_ACTION_LABEL, AUDIT_ENTITY_LABEL, auditEntityLabel, SUPER_ADMIN_EMPTY } from '@/lib/labels/super-admin';
import { useUrlState } from '@/lib/url-state';
import { AuditDetailDialog } from './AuditDetailDialog';
import { digitsOnly, FilterBar, InfiniteView, NativeSelect, rangeToIso, RangeError, UrlTextInput } from './audit-parts';
import { useAuditLogs, useTenantOptions } from './hooks-ops';

const KEYS = ['conta', 'usuario', 'entidade', 'acao', 'de', 'ate'] as const;
const ACTIONS = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];
const ENTITY_KEYS = Object.keys(AUDIT_ENTITY_LABEL);

export function AuditScreen() {
  const [url, setUrl] = useUrlState(KEYS);
  const [openId, setOpenId] = useState<string | null>(null);
  const tenants = useTenantOptions();
  const range = rangeToIso(url.de ?? '', url.ate ?? '');
  const action = ACTIONS.find((a) => a === url.acao);

  const query = useAuditLogs(
    {
      ...(url.conta ? { tenantId: url.conta } : {}),
      ...(url.usuario ? { userId: url.usuario } : {}),
      ...(url.entidade ? { entity: url.entidade } : {}),
      ...(action ? { action } : {}),
      ...(range.from ? { from: range.from } : {}),
      ...(range.to ? { to: range.to } : {}),
    },
    !range.error,
  );

  const columns = useMemo<ColumnDef<AuditLog, never>[]>(() => [
    { id: 'createdAt', header: 'Data e hora', cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{formatInstant(row.original.createdAt)}</span> },
    { id: 'tenant', header: 'Conta', cell: ({ row }) => row.original.tenantName ?? '—' },
    { id: 'user', header: 'Usuário', cell: ({ row }) => row.original.userEmail ?? '—' },
    { id: 'entity', header: 'Entidade', cell: ({ row }) => auditEntityLabel(row.original.entity) },
    { id: 'entityId', header: 'ID', cell: ({ row }) => <span className="tabular-nums">{row.original.entityId}</span> },
    { id: 'action', header: 'Ação', cell: ({ row }) => AUDIT_ACTION_LABEL[row.original.action] },
    { id: 'reason', header: 'Motivo', cell: ({ row }) => row.original.reason ?? '—' },
    {
      id: 'detail',
      header: () => <span className="sr-only">Detalhes</span>,
      cell: ({ row }) => (
        <Button variant="secondary" size="sm" aria-label={`Ver detalhes do registro ${row.original.id}`} onClick={() => setOpenId(row.original.id)}>Detalhes</Button>
      ),
    },
  ], []);

  const knownEntity = ENTITY_KEYS.includes(url.entidade ?? '');
  return (
    <PageHeader title="Auditoria" subtitle="Tudo o que o painel e as contas fizeram. Cada leitura entre contas também fica registrada aqui.">
      <FilterBar label="Filtros da auditoria">
        <NativeSelect
          label="Conta"
          value={url.conta ?? ''}
          onChange={(v) => setUrl({ conta: v })}
          options={(tenants.data?.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          allLabel="Todas as contas"
        />
        <UrlTextInput label="ID do usuário" value={url.usuario ?? ''} onCommit={(v) => setUrl({ usuario: v })} inputMode="numeric" sanitize={digitsOnly} />
        <NativeSelect
          label="Entidade"
          value={knownEntity ? (url.entidade ?? '') : ''}
          onChange={(v) => setUrl({ entidade: v })}
          options={ENTITY_KEYS.map((k) => ({ value: k, label: AUDIT_ENTITY_LABEL[k as keyof typeof AUDIT_ENTITY_LABEL] }))}
          allLabel="Todas as entidades"
        />
        <UrlTextInput label="Outra entidade (texto livre)" value={knownEntity ? '' : (url.entidade ?? '')} onCommit={(v) => setUrl({ entidade: v })} placeholder="ex.: employee" />
        <NativeSelect label="Ação" value={action ?? ''} onChange={(v) => setUrl({ acao: v })} options={ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] }))} allLabel="Todas as ações" />
        <DateInput label="De" value={url.de ?? ''} onChange={(e) => setUrl({ de: e.target.value })} />
        <DateInput label="Até" value={url.ate ?? ''} onChange={(e) => setUrl({ ate: e.target.value })} />
      </FilterBar>
      {range.error && <RangeError message={range.error} />}
      <InfiniteView query={query} what="a auditoria" empty={SUPER_ADMIN_EMPTY.audit} emptyIcon={ClipboardText}>
        {(rows) => (
          <DataTable<AuditLog>
            caption="Registros de auditoria"
            columns={columns}
            data={rows}
            getRowId={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            rowLabel={(r) => `Abrir o registro de auditoria ${r.id}`}
          />
        )}
      </InfiniteView>
      <AuditDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </PageHeader>
  );
}
