'use client';
/**
 * [SEM DESIGN] Detalhe do ajuste: "Marcação original" ao lado da "Proposta" e a decisão.
 * A marcação original é só leitura; aprovar ACRESCENTA a proposta ao dia (Portaria MTP 671/2021, arts. 74 e 82).
 */
import { LockKey } from '@phosphor-icons/react';
import { useState } from 'react';
import { PunchChips } from '@/components/domain';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { SidePanel } from '@/components/ui/SidePanel';
import { Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Adjustment, Role } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { DEFAULT_TZ, formatDate, formatInstant, formatTime } from '@/lib/format';
import { ADJUSTMENT_STATUS, ADJUSTMENT_TYPE } from '@/lib/labels';
import { useApiMutation, useApiQuery, useInvalidate } from '@/lib/query/hooks';
import { COPY } from './copy';
import { ApproveDialog } from './DecisionDialogs';

const DECISION_MODULES = ['adjustments', 'timesheets', 'day', 'mirrors'] as const;

export function AdjustmentPanel({ adjustment, role, name, registration, onClose }: {
  adjustment: Adjustment | undefined;
  role: Role;
  name: string;
  registration: string | null;
  onClose: () => void;
}) {
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const invalidate = useInvalidate();
  const approve = useApiMutation((api, v: { id: string; note: string | undefined }) => api.adjustments.approve(v.id, v.note ? { note: v.note } : {}), {
    invalidates: [...DECISION_MODULES],
  });
  const reject = useApiMutation((api, v: { id: string; reason: string }) => api.adjustments.reject(v.id, { reason: v.reason }), {
    invalidates: [...DECISION_MODULES],
  });

  /** 409 "já decidido": avisa, atualiza a lista e fecha o diálogo; outros erros ficam no diálogo. */
  const guarded = async (run: () => Promise<unknown>, done: string) => {
    try {
      await run();
      notify.success(done, 'A marcação original não foi alterada.');
    } catch (e) {
      const err = asApiError(e);
      if (err.status === 409 && err.code === 'STATUS_INVALIDO') {
        notify.error(err);
        await invalidate('adjustments');
        return;
      }
      throw err;
    }
  };

  const a = adjustment;
  const isPending = a?.status === 'pendente';
  const mayDecide = can(role, 'adjustment.decide');
  const mayDecideThis = mayDecide && (a?.type !== 'abono' || can(role, 'adjustment.decideAllowance'));

  let footer = null;
  if (a && isPending) {
    if (mayDecideThis) {
      footer = (
        <>
          <Button variant="secondary" onClick={() => setDialog('reject')}>{COPY.reject}</Button>
          <Button onClick={() => setDialog('approve')}>{COPY.approve}</Button>
        </>
      );
    } else if (mayDecide) {
      footer = <p className="m-0 flex items-center gap-2 text-sm font-medium text-ink-2"><LockKey size={18} aria-hidden />{COPY.abonoRhOnly}</p>;
    } else {
      footer = <p className="m-0 text-sm text-muted">{COPY.readOnly}</p>;
    }
  }

  return (
    <>
      <SidePanel
        open={Boolean(a)}
        onOpenChange={(o) => { if (!o) onClose(); }}
        title={a ? name : 'Ajuste'}
        description={a ? `${registration ? `Matrícula ${registration} · ` : ''}${ADJUSTMENT_TYPE[a.type].label} de ${formatDate(a.date)}` : undefined}
        width="lg"
        footer={footer}
      >
        {a && <Body adjustment={a} />}
      </SidePanel>
      {a && (
        <>
          <ApproveDialog
            open={dialog === 'approve'}
            onOpenChange={(o) => setDialog(o ? 'approve' : null)}
            title={COPY.approveTitle}
            description={COPY.neverChanges}
            noteLabel={COPY.approveNote}
            confirmLabel={COPY.approve}
            onConfirm={(note) => guarded(() => approve.mutateAsync({ id: a.id, note }), 'Ajuste aprovado')}
          />
          <ConfirmDialog
            open={dialog === 'reject'}
            onOpenChange={(o) => setDialog(o ? 'reject' : null)}
            title={COPY.rejectTitle}
            description="O pedido é recusado e a apuração do dia continua como está. A marcação original não é alterada."
            confirmLabel={COPY.reject}
            tone="danger"
            reason={{ label: COPY.rejectReason, min: 3, max: 500 }}
            onConfirm={(reason) => guarded(() => reject.mutateAsync({ id: a.id, reason: reason ?? '' }), 'Ajuste recusado')}
          />
        </>
      )}
    </>
  );
}

function Body({ adjustment: a }: { adjustment: Adjustment }) {
  const day = useApiQuery(
    'timesheets',
    { adjustmentDay: a.employeeId, date: a.date },
    async (api, signal) => (await api.timesheets.byEmployee(a.employeeId, { from: a.date, to: a.date }, signal)).find((d) => d.date === a.date) ?? null,
  );
  const st = ADJUSTMENT_STATUS[a.status];
  const originals = (day.data?.punches ?? []).filter((p) => p.origin === 'original');

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Comparação" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-card border border-line bg-white p-4">
          <h3 className="m-0 text-sm font-bold">{COPY.originalTitle}</h3>
          <p className="m-0 text-xs text-muted">{COPY.originalHint}</p>
          {day.isPending ? (
            <Skeleton className="h-7 w-3/4" />
          ) : day.isError ? (
            <p role="alert" className="m-0 text-sm text-danger">Não foi possível carregar as marcações do dia.</p>
          ) : (
            <PunchChips punches={originals} tz={DEFAULT_TZ} />
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-dashed border-brand bg-tint/40 p-4">
          <h3 className="m-0 text-sm font-bold">{COPY.proposalTitle}</h3>
          <p className="m-0 text-xs text-muted">{COPY.proposalAdds}</p>
          <Proposal adjustment={a} />
        </div>
      </section>

      <p className="m-0 rounded-md bg-surface px-3 py-2 text-xs text-ink-2">{COPY.neverChanges}</p>

      <KeyValueList
        items={[
          { label: 'Dia', value: formatDate(a.date, 'long') },
          { label: 'Tipo', value: ADJUSTMENT_TYPE[a.type].label },
          { label: 'Situação', value: <StatusBadge label={st.label} tone={st.tone} /> },
          { label: 'Motivo do pedido', value: a.reason },
          { label: 'Solicitado em', value: formatInstant(a.requestedAt) },
          ...(a.decidedAt ? [{ label: COPY.decidedBy, value: formatInstant(a.decidedAt) }] : []),
          ...(a.decisionReason ? [{ label: a.status === 'recusado' ? 'Motivo da recusa' : 'Observação', value: a.decisionReason }] : []),
        ]}
      />
    </div>
  );
}

function Proposal({ adjustment: a }: { adjustment: Adjustment }) {
  if (a.type === 'inclusao_batida' && a.proposedAt) {
    return (
      <p className="m-0 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-dashed border-brand bg-white px-2.5 py-0.5 text-xs font-semibold tabular-nums">{formatTime(a.proposedAt, DEFAULT_TZ)}</span>
        <span className="text-sm text-ink-2">Marcação a acrescentar</span>
      </p>
    );
  }
  if (a.type === 'abono') return <p className="m-0 text-sm text-ink-2">Abono do dia, com o motivo do pedido.</p>;
  return <p className="m-0 text-sm text-ink-2">Justificativa do dia, com o motivo do pedido.</p>;
}
