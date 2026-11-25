'use client';
import { FileText, HourglassMedium, LockKey, SealCheck } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { KeyValueList, type KeyValueItem } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { CidValue } from '@/components/ui/SensitiveValue';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { can } from '@/lib/auth/permissions';
import type { Certificate, CertificateRh, EntityId, Role } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { addCivilDays, formatDate, formatInstant, formatPeriod } from '@/lib/format';
import { CERTIFICATE_STATUS } from '@/lib/labels';
import { useApiMutation, useApiQuery, useInvalidate } from '@/lib/query/hooks';
import { AnalysisSection } from './AnalysisSection';
import { COPY } from './copy';

/** Período do afastamento para exibir: "20 e 21/11"-like vem do formatPeriod; por horas, "3 h em 20/11/2026". */
export function describeLeave(c: Certificate): string {
  if (c.days !== null) return c.days === 1 ? formatDate(c.startDate) : formatPeriod(c.startDate, addCivilDays(c.startDate, c.days - 1));
  return `${c.hours ?? 0} h em ${formatDate(c.startDate)}`;
}

const isRhView = (c: Certificate | CertificateRh): c is CertificateRh => 'doctorName' in c;

const AFFECTED = ['certificates', 'analyses', 'timesheets', 'day', 'absences'] as const;

/**
 * Painel de detalhe do atestado. Montado com `key={id}`: ao trocar de item ou fechar o painel tudo daqui
 * (texto colado, blobs do arquivo) é descartado.
 */
export function CertificateDetail({ certificate, role, name, registration, showHeader }: {
  certificate: Certificate | CertificateRh;
  role: Role;
  name: string;
  registration: string | null;
  showHeader: boolean;
}) {
  const id: EntityId = certificate.id;
  const canAnalyze = can(role, 'certificate.analyze');
  const analysesQuery = useApiQuery('analyses', { certificateId: id }, (api, signal) => api.certificates.analyses(id, signal), { enabled: canAnalyze });
  const rh = isRhView(certificate) && can(role, 'certificate.viewDoctor') ? certificate : null;
  const status = CERTIFICATE_STATUS[certificate.status];
  const pending = certificate.status === 'pendente';
  // [A CONFIRMAR] Etapa da fila do design (Recebido / Em análise) derivada: pendente sem análise = Recebido; com análise = Em análise.
  const stage = canAnalyze && pending && analysesQuery.data ? (analysesQuery.data.length === 0 ? 'Recebido' : 'Em análise') : null;

  const items: KeyValueItem[] = [
    { label: 'Enviado em', value: formatInstant(certificate.sentAt) },
    { label: 'Afastamento', value: describeLeave(certificate) },
    ...(rh
      ? [{ label: 'Médico', value: rh.doctorName ? `${rh.doctorName}${rh.doctorCrm ? ` · CRM ${rh.doctorCrm}${rh.doctorCrmUf ? `/${rh.doctorCrmUf}` : ''}` : ''}` : 'Não informado' }]
      : []),
    ...(can(role, 'certificate.viewCid') ? [] : [{ label: 'CID', value: <CidValue role={role} value={null} /> }]),
  ];

  return (
    <div className="flex flex-col">
      {showHeader && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-5">
          <Avatar name={name} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="m-0 text-xl font-bold tracking-[-0.01em]">{name}</h2>
            {registration && <span className="text-xs text-muted">Matrícula {registration}</span>}
          </div>
          <StatusBadge tone={status.tone} label={status.label} />
        </div>
      )}
      <div className="flex flex-col gap-5 px-6 py-5">
        {!showHeader && <div><StatusBadge tone={status.tone} label={status.label} /></div>}
        {stage && <p className="m-0 text-xs text-muted">{COPY.stageNote}{stage}</p>}
        <KeyValueList items={items} />
        {rh && certificate.status === 'recusado' && rh.decisionReason && (
          <p className="m-0 text-sm text-ink-2">{`Motivo da recusa: ${rh.decisionReason}`}</p>
        )}

        {can(role, 'certificate.viewFile')
          ? <FileButton certificateId={id} />
          : (
            <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-3 text-sm">
              <LockKey size={20} aria-hidden />
              <div className="flex flex-col"><span className="font-semibold">{COPY.fileRestrictedTitle}</span><span className="text-xs text-muted">{COPY.fileRestrictedText}</span></div>
            </div>
          )}

        {canAnalyze && <AnalysisSection certificateId={id} role={role} pending={pending} query={analysesQuery} />}
      </div>
      <DecisionBar certificate={certificate} role={role} />
    </div>
  );
}

/** Abre o arquivo (download auditado) como Blob em outra aba. O blob nunca é guardado e a URL é revogada ao fechar. */
function FileButton({ certificateId }: { certificateId: EntityId }) {
  const urls = useMemo(() => new Set<string>(), []);
  useEffect(() => () => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  }, [urls]);

  const file = useApiMutation((api, id: EntityId) => api.certificates.file(id));
  const open = () => {
    // A aba é aberta no clique (evita bloqueio de pop-up) e recebe o blob quando ele chega.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    file.mutate(certificateId, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        urls.add(url);
        if (tab) tab.location.href = url;
        else window.open(url, '_blank');
      },
      onError: (e) => {
        tab?.close();
        notify.error(e);
      },
    });
  };
  return (
    <div>
      <Button variant="secondary" icon={<FileText size={18} aria-hidden />} loading={file.isPending} onClick={open}>{COPY.openFile}</Button>
    </div>
  );
}

function DecisionBar({ certificate, role }: { certificate: Certificate | CertificateRh; role: Role }) {
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const invalidate = useInvalidate();
  const approve = useApiMutation((api, id: EntityId) => api.certificates.approve(id), {
    invalidates: [...AFFECTED],
    onSuccess: () => notify.success('Atestado aprovado', 'Os dias serão recalculados'),
  });
  const reject = useApiMutation((api, v: { id: EntityId; reason: string }) => api.certificates.reject(v.id, { reason: v.reason }), {
    invalidates: [...AFFECTED],
    onSuccess: () => notify.success('Atestado recusado'),
  });

  /** 409: outra pessoa já decidiu. Avisa, recarrega o item e fecha o diálogo (sem repetir a ação). */
  const guard = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (e) {
      const err = asApiError(e);
      if (err.status !== 409) throw err;
      notify.error(err);
      await invalidate(...AFFECTED);
    }
  };

  if (certificate.status !== 'pendente') {
    const verb = certificate.status === 'aprovado' ? 'Aprovado' : 'Recusado';
    return (
      <div className="border-t border-line bg-surface-alt px-6 py-4">
        <span className="flex items-center gap-2 text-sm text-ink-2">
          <SealCheck size={18} aria-hidden />
          {certificate.decidedAt ? `${verb} em ${formatInstant(certificate.decidedAt)}` : verb}
        </span>
      </div>
    );
  }

  if (!can(role, 'certificate.approve')) {
    return (
      <div className="border-t border-line bg-surface-alt px-6 py-4">
        <span className="flex items-center gap-2 text-sm text-muted"><HourglassMedium size={18} aria-hidden />{COPY.waitingRh}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-alt px-6 py-4">
      <span className="text-xs text-muted">{COPY.approveHint}</span>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setDialog('reject')}>Recusar</Button>
        <Button onClick={() => setDialog('approve')}>Aprovar</Button>
      </div>
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => setDialog(o ? 'approve' : null)}
        title="Aprovar este atestado?"
        description="O afastamento será registrado e os dias recalculados. A marcação original não é alterada. A decisão não pode ser desfeita."
        confirmLabel="Aprovar atestado"
        onConfirm={() => guard(() => approve.mutateAsync(certificate.id))}
      />
      <ConfirmDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => setDialog(o ? 'reject' : null)}
        title="Recusar este atestado?"
        description="O colaborador vê o motivo da recusa. A decisão não pode ser desfeita."
        confirmLabel="Recusar atestado"
        tone="danger"
        reason={{ label: 'Motivo da recusa', min: 3, max: 500 }}
        onConfirm={(reason) => guard(() => reject.mutateAsync({ id: certificate.id, reason: reason ?? '' }))}
      />
    </div>
  );
}
