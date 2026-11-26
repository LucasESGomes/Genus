'use client';
/**
 * Calibração do totem (docs/totem-contrato.md §1 item 7). A captura acontece NO totem (`/totem`), não no painel:
 * "Calibrar" inicia uma sessão -> "Aguardando o totem" (consulta a sessão a cada 3 s, só com a aba visível)
 * -> quando `calculada`: atual x proposto, qualidade, recomendações e histograma -> Aplicar | Descartar.
 * Também: Resetar para o padrão e Copiar de outro totem do mesmo estabelecimento.
 *
 * Nenhuma imagem nem embedding passa por aqui (só números agregados).
 * [A CONFIRMAR] se o limiar só sinaliza (a batida nunca é bloqueada, Portaria 671) e como as batidas abaixo do
 * limiar aparecem para o RH revisar.
 */
import { ArrowCounterClockwise, Copy, Hourglass, Play, Warning, XCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField } from '@/components/ui/Fields';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { notify } from '@/components/ui/notify';
import type { CalibrationProfile, CalibrationProfileName, CalibrationSession, CalibrationSessionResult, CalibrationThresholds, Device, DeviceCalibrationSettings } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { formatInstant } from '@/lib/format';
import { CALIBRATION_STATE } from '@/lib/labels';
import { useApiQuery } from '@/lib/query/hooks';
import { CalibrationChart } from './calibration/CalibrationChart';
import { COPY } from './copy';
import { useApplyCalibration, useCopyCalibration, useDiscardCalibration, usePageVisible, useResetCalibration, useStartCalibration } from './hooks';
import { OpenTotemLink } from './OpenTotemLink';

const C = COPY.calibration;
const fmt = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Intervalo de consulta da sessão enquanto o totem não terminou. */
const POLL_MS = 3000;

type Confirm = 'reset' | 'cancel' | 'copy' | null;

export function CalibrationTab({ device }: { device: Device }) {
  const id = device.id;
  const visible = usePageVisible();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [sourceId, setSourceId] = useState('');

  const settings = useApiQuery('calibration', { settings: id }, (api, signal) => api.devices.calibration(id, signal));
  const session = useApiQuery('calibration', { session: id }, (api, signal) => api.devices.calibrationSession(id, signal), {
    // Só consulta enquanto espera o totem e a aba está visível; desmontar a tela também encerra.
    refetchInterval: (q) => (q.state.data?.status === 'aguardando' && visible ? POLL_MS : false),
  });
  const others = useApiQuery('devices', { list: true, establishmentId: device.establishmentId, copy: true }, (api, signal) => api.devices.list({ establishmentId: device.establishmentId }, signal));

  const start = useStartCalibration();
  const discard = useDiscardCalibration();
  const apply = useApplyCalibration();
  const reset = useResetCalibration();
  const copy = useCopyCalibration();

  const attempt = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify.error(asApiError(e));
    }
  };

  const sources = (others.data ?? []).filter((d) => d.id !== id);
  const source = sources.find((d) => d.id === sourceId);
  const computed = session.data?.status === 'calculada' ? session.data.result : null;
  // Perfil escolhido pelo RH; sem escolha, vale o recomendado. Sem `profiles`, o proposto.
  const [chosen, setChosen] = useState<CalibrationProfileName | null>(null);
  const profile =
    computed?.profiles?.find((p) => p.profile === chosen) ??
    computed?.profiles?.find((p) => p.profile === computed.recommendedProfile) ??
    null;
  const proposed = computed
    ? { ...computed.proposed, ...(profile ? { recognitionThreshold: profile.recognitionThreshold } : {}) }
    : null;

  const flow = (s: CalibrationSession | null) => {
    if (s === null) {
      if (!device.isActive) {
        return (
          <div className="flex flex-col gap-2">
            <h2 className="m-0 text-base font-bold">{C.startTitle}</h2>
            <p className="m-0 text-sm text-muted">{C.inactiveText}</p>
          </div>
        );
      }
      return (
        <div className="flex flex-col items-start gap-3">
          <h2 className="m-0 text-base font-bold">{C.startTitle}</h2>
          <p className="m-0 max-w-[620px] text-sm text-muted">{C.startText}</p>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Play size={18} aria-hidden />} loading={start.isPending} onClick={() => void attempt(async () => { setChosen(null); await start.mutateAsync(id); })}>{C.start}</Button>
            <OpenTotemLink />
          </div>
          <p className="m-0 max-w-[620px] text-xs text-muted">{COPY.openTotem.hint}</p>
        </div>
      );
    }
    if (s.status === 'aguardando') {
      return (
        <div className="flex flex-col items-start gap-3">
          <div>
            <h2 className="m-0 flex items-center gap-2 text-base font-bold"><Hourglass size={20} aria-hidden />{C.waitingTitle}</h2>
            <p role="status" className="m-0 mt-1 text-sm text-muted">{C.waitingText}</p>
            <p className="m-0 mt-1 text-xs text-muted tabular-nums">Iniciada em {formatInstant(s.startedAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OpenTotemLink />
            <Button variant="secondary" icon={<XCircle size={18} aria-hidden />} onClick={() => setConfirm('cancel')}>{C.cancel}</Button>
          </div>
        </div>
      );
    }
    if (s.status === 'calculada' && s.result) {
      return (
        <Preview
          result={s.result}
          selected={profile?.profile ?? null}
          onSelect={setChosen}
          thresholds={proposed ?? s.result.proposed}
          applying={apply.isPending}
          discarding={discard.isPending}
          onApply={(t) => void attempt(async () => { await apply.mutateAsync({ id, proposed: t }); notify.success(C.applied); })}
          onDiscard={() => void attempt(async () => { await discard.mutateAsync(id); notify.success(C.discarded); })}
        />
      );
    }
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-warn bg-warn-bg p-4">
        <p className="m-0 flex items-center gap-2 font-semibold text-warn"><Warning size={20} weight="fill" aria-hidden />{C.failedTitle}</p>
        <p className="m-0 text-sm text-ink-2">{C.failedText}</p>
        <Button variant="secondary" loading={discard.isPending} onClick={() => void attempt(async () => { await discard.mutateAsync(id); })}>{C.failedAction}</Button>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 max-w-[720px] rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink-2">{C.note}</p>
      <Card as="section" className="p-5">
        <QueryView query={session} what="a calibração" loading={<Skeleton className="h-40 w-full" />}>
          {(s) => flow(s)}
        </QueryView>
      </Card>

      <Card as="section" className="flex flex-col gap-4 p-5">
        <h2 className="m-0 text-base font-bold">{C.currentTitle}</h2>
        <QueryView query={settings} what="a calibração" loading={<Skeleton className="h-32 w-full" />}>
          {(s) => (
            <>
              <Compare settings={s} proposed={proposed} />
              <SettingsMeta settings={s} state={device.calibrationState} />
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<ArrowCounterClockwise size={18} aria-hidden />} disabled={!s.isCalibrated} onClick={() => setConfirm('reset')}>{C.reset}</Button>
              </div>
            </>
          )}
        </QueryView>
      </Card>

      <Card as="section" className="flex flex-col gap-3 p-5">
        <h2 className="m-0 text-base font-bold">{C.copyTitle}</h2>
        <p className="m-0 text-sm text-muted">{C.copyText}</p>
        {sources.length === 0 ? (
          <p className="m-0 text-sm text-ink-2">{C.copyNone}</p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1 sm:max-w-[320px]">
              <SelectField label={C.copySource} placeholder={C.copyPlaceholder} value={sourceId} onValueChange={setSourceId} options={sources.map((d) => ({ value: d.id, label: `${d.name} (${CALIBRATION_STATE[d.calibrationState].label})` }))} />
            </div>
            <Button variant="secondary" icon={<Copy size={18} aria-hidden />} disabled={!source} onClick={() => setConfirm('copy')}>{C.copy}</Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => setConfirm(o ? 'cancel' : null)}
        title={C.cancelTitle}
        description={C.cancelText}
        confirmLabel={C.cancelConfirm}
        onConfirm={async () => { await discard.mutateAsync(id); }}
      />
      <ConfirmDialog
        open={confirm === 'reset'}
        onOpenChange={(o) => setConfirm(o ? 'reset' : null)}
        tone="danger"
        title={C.resetTitle}
        description={C.resetText}
        confirmLabel={C.resetConfirm}
        onConfirm={async () => { await reset.mutateAsync(id); notify.success(C.resetDone); }}
      />
      <ConfirmDialog
        open={confirm === 'copy'}
        onOpenChange={(o) => setConfirm(o ? 'copy' : null)}
        title={C.copyConfirmTitle}
        description={C.copyConfirmText(source?.name ?? 'o totem escolhido')}
        confirmLabel={C.copyConfirmLabel}
        onConfirm={async () => {
          await copy.mutateAsync({ id, sourceDeviceId: sourceId });
          setSourceId('');
          notify.success(C.copied);
        }}
      />
    </div>
  );
}

function Preview({ result, selected, onSelect, thresholds, applying, discarding, onApply, onDiscard }: {
  result: CalibrationSessionResult;
  selected: CalibrationProfileName | null;
  onSelect: (profile: CalibrationProfileName) => void;
  /** Valores que "Aplicar" envia: o perfil escolhido + a vivacidade proposta. */
  thresholds: CalibrationThresholds;
  applying: boolean;
  discarding: boolean;
  onApply: (proposed: CalibrationThresholds) => void;
  onDiscard: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="m-0 text-base font-bold">{C.previewTitle}</h2>
      <p className="m-0 text-sm"><span className="font-semibold">{C.quality}:</span> <span className="tabular-nums">{result.qualityScore} de 100</span></p>
      {result.recommendations.length > 0 && (
        <div>
          <p className="m-0 text-sm font-semibold">{C.recommendations}</p>
          <ul className="mt-1 mb-0 list-disc pl-5 text-sm text-ink-2">{result.recommendations.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}
      {result.profiles && result.profiles.length > 0 && (
        <ProfileChoice profiles={result.profiles} recommended={result.recommendedProfile} selected={selected} onSelect={onSelect} />
      )}
      <CalibrationChart result={{ ...result, proposed: thresholds }} />
      <div className="flex flex-wrap gap-2">
        <Button loading={applying} onClick={() => onApply(thresholds)}>{C.apply}</Button>
        <Button variant="secondary" loading={discarding} onClick={onDiscard}>{C.discardResult}</Button>
      </div>
    </div>
  );
}

const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function ProfileChoice({ profiles, recommended, selected, onSelect }: {
  profiles: CalibrationProfile[];
  recommended: CalibrationProfileName | undefined;
  selected: CalibrationProfileName | null;
  onSelect: (profile: CalibrationProfileName) => void;
}) {
  const current = profiles.find((p) => p.profile === selected);
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-2 p-0 text-sm font-semibold">{C.profilesLabel}</legend>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {profiles.map((p) => (
          <label key={p.profile} className={`flex cursor-pointer flex-col gap-1.5 rounded-md border p-3.5 text-sm ${p.profile === selected ? 'border-brand bg-surface' : 'border-line'}`}>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="calibration-profile" value={p.profile} checked={p.profile === selected} onChange={() => onSelect(p.profile)} />
                {p.label}
              </span>
              {p.profile === recommended && <StatusBadge label={C.recommended} tone="info" />}
            </span>
            <span className="text-xs font-semibold text-muted">{C.profilePriority[p.profile]}</span>
            <span className="text-ink-2"><b className="tabular-nums">{percent(p.genuineAcceptRate)}</b> {C.genuineRate}</span>
            <span className="text-ink-2"><b className="tabular-nums">{percent(1 - p.impostorRejectRate)}</b> {C.impostorRate}</span>
          </label>
        ))}
      </div>
      {current && <p className="m-0 max-w-[720px] text-sm text-ink-2">{current.interpretation}</p>}
    </fieldset>
  );
}

function Compare({ settings, proposed }: { settings: DeviceCalibrationSettings; proposed: CalibrationThresholds | null }) {
  const rows = [
    { label: C.recognition, hint: C.recognitionHint, current: settings.effectiveRecognitionThreshold, own: settings.recognitionThreshold !== null, proposed: proposed?.recognitionThreshold },
    { label: C.liveness, hint: C.livenessHint, current: settings.effectiveLivenessThreshold, own: settings.livenessThreshold !== null, proposed: proposed?.livenessThreshold },
  ];
  return (
    <table className="w-full max-w-[640px] border-collapse text-left text-sm">
      <caption className="sr-only">Valores atuais e propostos do reconhecimento</caption>
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          <th scope="col" className="py-2 pr-4 font-semibold">Limiar</th>
          <th scope="col" className="py-2 pr-4 font-semibold">{C.colCurrent}</th>
          <th scope="col" className="py-2 font-semibold">{C.colProposed}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-line-soft">
            <th scope="row" className="py-3 pr-4 font-medium">{r.label}<span className="block text-xs font-normal text-muted">{r.hint}</span></th>
            <td className="py-3 pr-4 tabular-nums">{fmt(r.current)}{!r.own && <span className="block text-xs text-muted">{C.inherits}</span>}</td>
            <td className="py-3 tabular-nums">{r.proposed === undefined ? <span className="text-muted">{C.notComputed}</span> : <span className="font-semibold">{fmt(r.proposed)}</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingsMeta({ settings, state }: { settings: DeviceCalibrationSettings; state: Device['calibrationState'] }) {
  const label = CALIBRATION_STATE[state];
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
      <StatusBadge label={label.label} tone={label.tone} />
      {settings.isCalibrated && settings.calibratedAt ? (
        <span>
          {C.calibratedAt(formatInstant(settings.calibratedAt))}
          {settings.calibrationSourceName ? `. ${C.copiedFrom(settings.calibrationSourceName)}` : ''}
        </span>
      ) : (
        <span>{C.notCalibrated}</span>
      )}
    </div>
  );
}
