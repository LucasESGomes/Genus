'use client';
/** Detalhe de um registro de auditoria: quem, o quê, e o estado antes e depois lado a lado (valores já redigidos pela api). */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import type { EntityId } from '@/lib/api/contracts';
import type { AuditLogDetail } from '@/lib/api/super-admin-contracts';
import { formatInstant } from '@/lib/format';
import { AUDIT_ACTION_LABEL, auditEntityLabel } from '@/lib/labels/super-admin';
import { useAuditDetail } from './hooks-ops';

export interface DiffRow {
  key: string;
  before: string | null;
  after: string | null;
  changed: boolean;
}

const show = (v: unknown): string => JSON.stringify(v) ?? 'undefined';

/** Une as chaves de antes e depois (ordem de aparição) e marca as que mudaram. */
export function diffStates(before: Record<string, unknown> | null, after: Record<string, unknown> | null): DiffRow[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys.map((key) => {
    const b = before && Object.hasOwn(before, key) ? show(before[key]) : null;
    const a = after && Object.hasOwn(after, key) ? show(after[key]) : null;
    return { key, before: b, after: a, changed: b !== a };
  });
}

const cell = (v: string | null) => (v === null ? <span className="text-muted" aria-label="sem valor">—</span> : <code className="break-all font-mono text-xs">{v}</code>);

function DetailBody({ data }: { data: AuditLogDetail }) {
  const rows = diffStates(data.before, data.after);
  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
      <KeyValueList
        items={[
          { label: 'Data e hora', value: formatInstant(data.createdAt) },
          { label: 'Conta', value: data.tenantName ?? '—' },
          { label: 'Usuário', value: data.userEmail ?? '—' },
          { label: 'Entidade', value: `${auditEntityLabel(data.entity)} (#${data.entityId})` },
          { label: 'Ação', value: AUDIT_ACTION_LABEL[data.action] },
          { label: 'Motivo', value: data.reason ?? '—' },
        ]}
      />
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted">Este registro não guardou o estado antes nem depois.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line" role="region" aria-label="Antes e depois" tabIndex={0}>
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Estado antes e depois da ação, campo a campo</caption>
            <thead>
              <tr className="border-b border-line bg-surface">
                <th scope="col" className="px-3 py-2 font-semibold">Campo</th>
                <th scope="col" className="px-3 py-2 font-semibold">Antes</th>
                <th scope="col" className="px-3 py-2 font-semibold">Depois</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} data-changed={r.changed} className={`border-b border-line last:border-0 ${r.changed ? 'bg-warn-bg' : ''}`}>
                  <th scope="row" className="px-3 py-2 align-top font-medium">
                    {r.key}
                    {r.changed && <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-warn">mudou</span>}
                  </th>
                  <td className="px-3 py-2 align-top">{cell(r.before)}</td>
                  <td className="px-3 py-2 align-top">{cell(r.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AuditDetailDialog({ id, onClose }: { id: EntityId | null; onClose: () => void }) {
  return (
    <Dialog open={id !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {id !== null && <AuditDetailContent id={id} />}
    </Dialog>
  );
}

function AuditDetailContent({ id }: { id: EntityId }) {
  const query = useAuditDetail(id);
  return (
    <DialogContent className="gap-4 sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">Registro de auditoria #{id}</DialogTitle>
        <DialogDescription>Valores sensíveis já vêm ocultos da api e aparecem como recebidos.</DialogDescription>
      </DialogHeader>
      <QueryView query={query} what="o registro" loading={<div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-2"><Skeleton className="h-6 w-full" /><Skeleton className="h-24 w-full" /></div>}>
        {(data) => <DetailBody data={data} />}
      </QueryView>
    </DialogContent>
  );
}
