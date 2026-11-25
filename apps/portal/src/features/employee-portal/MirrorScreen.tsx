'use client';
import { CheckCircle, Flag, Moon, PlusCircle, SealCheck, WarningCircle, Info } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Minutes } from '@/components/domain';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MonthPicker } from '@/components/ui/MonthPicker';
import { QueryView } from '@/components/ui/QueryView';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { notify } from '@/components/ui/notify';
import type { MyMirrorSummary, TimesheetDay } from '@/lib/api/contracts';
import { useClock } from '@/lib/clock-context';
import { DEFAULT_TZ, formatDate, formatInstant, formatMinutes, formatMonth, formatTime, monthOf, monthRange, todayCivil, weekdayShort } from '@/lib/format';
import { useUrlState } from '@/lib/url-state';
import { CalendarBlank } from '@phosphor-icons/react';
import { AdjustmentSheet } from './AdjustmentSheet';
import { COPY, situationLabel } from './copy';
import { useAcknowledge, useMyMirrors, useMyTimesheets } from './hooks';
import { LoadingBlock } from './parts';
import { PortalFrame } from './PortalFrame';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Espelho do mês: dias, totais para exibição, ciência do espelho fechado e pedido de ajuste. */
export function MirrorScreen() {
  const clock = useClock();
  const today = todayCivil(clock, DEFAULT_TZ);
  const [{ mes }, setUrl] = useUrlState(['mes']);
  const month = mes && MONTH_RE.test(mes) ? mes : monthOf(today);
  const { from, to } = monthRange(month);
  const q = useMyTimesheets(from, to);
  const [adjusting, setAdjusting] = useState(false);

  return (
    <PortalFrame title="Espelho" subtitle={capitalize(formatMonth(month))}>
      <div className="flex justify-center"><MonthPicker value={month} onChange={(m) => setUrl({ mes: m })} /></div>
      <QueryView
        query={q}
        what="o espelho"
        loading={<MirrorSkeleton />}
        isEmpty={(days) => days.length === 0}
        empty={<><EmptyState icon={CalendarBlank} title="Sem marcações neste mês" text="Quando houver dias apurados, eles aparecem aqui." /><AcknowledgementCard month={month} /></>}
      >
        {(days) => (
          <>
            <Totals days={days} />
            <DayList days={days} />
            <AcknowledgementCard month={month} />
          </>
        )}
      </QueryView>
      <Button variant="secondary" className="min-h-12 w-full font-bold" onClick={() => setAdjusting(true)}>{COPY.requestAdjustment}</Button>
      <AdjustmentSheet open={adjusting} onOpenChange={setAdjusting} defaultDate={month === monthOf(today) ? today : from} />
    </PortalFrame>
  );
}

function MirrorSkeleton() {
  return (
    <LoadingBlock className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2.5"><Skeleton className="h-16 rounded-card" /><Skeleton className="h-16 rounded-card" /></div>
      <Skeleton className="h-64 rounded-card" />
    </LoadingBlock>
  );
}

/** Totais só para exibir: soma simples dos minutos que a api entregou (sem regra trabalhista). */
function Totals({ days }: { days: TimesheetDay[] }) {
  const worked = days.reduce((acc, d) => acc + d.workedMinutes, 0);
  const extra = days.reduce((acc, d) => acc + d.overtime50Minutes + d.overtime100Minutes, 0);
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <div className="rounded-card border border-line p-3.5"><span className="block text-xs text-muted">Trabalhado</span><span className="text-xl font-bold"><Minutes value={worked} /></span></div>
      <div className="rounded-card border border-line p-3.5"><span className="block text-xs text-muted">Extras</span><span className="text-xl font-bold text-brand"><Minutes value={extra} signed /></span></div>
    </div>
  );
}

function daySituation(d: TimesheetDay): { label: string; icon: Icon; muted: boolean } {
  const extra = d.overtime50Minutes + d.overtime100Minutes;
  if (d.status === 'inconsistente') return { label: 'Marcações incompletas', icon: WarningCircle, muted: false };
  if (d.situation === 'feriado') return { label: situationLabel(d.situation), icon: Flag, muted: true };
  if (d.situation === 'folga') return { label: situationLabel(d.situation), icon: Moon, muted: true };
  if (d.punches.some((p) => p.origin === 'tratada')) return { label: 'Ajuste aprovado', icon: CheckCircle, muted: false };
  if (extra > 0) return { label: `Extra ${formatMinutes(extra)}`, icon: PlusCircle, muted: false };
  return { label: situationLabel(d.situation), icon: CheckCircle, muted: d.situation !== 'normal' };
}

function DayList({ days }: { days: TimesheetDay[] }) {
  const ordered = [...days].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ul aria-label="Dias do mês" className="m-0 list-none overflow-hidden rounded-card border border-line p-0">
      {ordered.map((d) => {
        const sit = daySituation(d);
        const punches = [...d.punches].sort((a, b) => a.sequence - b.sequence);
        const I = sit.icon;
        return (
          <li key={d.date} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex w-12 flex-col leading-tight">
              <span className="text-xs text-muted">{weekdayShort(d.date)}</span>
              <span className="font-bold tabular-nums">{formatDate(d.date, 'dayMonth')}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col leading-snug">
              <span className="text-sm tabular-nums text-ink-2">{punches.length === 0 ? '—' : punches.map((p) => formatTime(p.at, DEFAULT_TZ)).join(' · ')}</span>
              <span className={`flex items-center gap-1 text-xs ${sit.muted ? 'text-muted' : 'text-brand'}`}><I size={14} weight="fill" aria-hidden />{sit.label}</span>
            </div>
            <span className="font-bold">{punches.length === 0 ? '—' : <Minutes value={d.workedMinutes} />}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Ciência do espelho do mês. Só existe com a competência fechada; reabrir apaga a ciência. */
function AcknowledgementCard({ month }: { month: string }) {
  const q = useMyMirrors();
  return (
    <QueryView query={q} what="a ciência do espelho" loading={<LoadingBlock><Skeleton className="h-20 rounded-card" /></LoadingBlock>}>
      {(mirrors) => <AcknowledgementBody mirror={mirrors.find((m) => m.referenceMonth === month)} month={month} />}
    </QueryView>
  );
}

function AcknowledgementBody({ mirror, month }: { mirror: MyMirrorSummary | undefined; month: string }) {
  const [confirming, setConfirming] = useState(false);
  const ack = useAcknowledge();
  const name = formatMonth(month);

  if (!mirror || mirror.status === 'aberto') {
    return (
      <p className="m-0 flex items-start gap-2 text-sm text-muted"><Info size={18} aria-hidden className="mt-px shrink-0" />Este mês ainda está aberto. A ciência fica disponível quando o RH fechar o espelho.</p>
    );
  }
  if (mirror.status === 'reaberto') {
    return (
      <div role="note" className="flex items-start gap-3 rounded-card border border-line bg-surface p-4">
        <WarningCircle size={24} aria-hidden className="shrink-0 text-warn" />
        <div className="flex flex-col text-sm">
          <span className="font-bold">O RH reabriu este mês</span>
          <span className="text-ink-2">A sua ciência anterior foi apagada. Quando o mês for fechado de novo, você poderá dar ciência outra vez.</span>
        </div>
      </div>
    );
  }
  if (mirror.acknowledgedAt) {
    return (
      <div className="flex items-center gap-3 rounded-card bg-tint p-4">
        <SealCheck size={24} aria-hidden className="shrink-0 text-brand" />
        <div className="flex flex-col text-sm">
          <span className="font-bold">Ciência dada</span>
          <span className="text-ink-2">Registrada em {formatInstant(mirror.acknowledgedAt, DEFAULT_TZ)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-card bg-tint p-4">
      <div className="flex items-start gap-3">
        <SealCheck size={24} aria-hidden className="shrink-0 text-brand" />
        <div className="flex flex-col text-sm">
          <span className="font-bold">O espelho de {name} está fechado</span>
          <span className="text-ink-2">Confira os dias acima. Se estiver tudo certo, dê a sua ciência.</span>
        </div>
      </div>
      <Button className="min-h-12 w-full font-bold" onClick={() => setConfirming(true)}>Dar ciência</Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Você conferiu seu espelho?"
        description={`Ao confirmar, você diz que viu as marcações de ${name} e está ciente delas. Se algo estiver errado, feche esta janela e peça o ajuste antes.`}
        confirmLabel="Estou ciente"
        onConfirm={async () => {
          await ack.mutateAsync(mirror.closingId);
          notify.success('Ciência registrada');
        }}
      />
    </div>
  );
}
