import { ArrowRight, Info, Warning } from '@phosphor-icons/react/dist/ssr';
import type { OverviewAlert } from '@/lib/api/contracts';

/** Alerta (âmbar) ou sinal (azul). Sempre ícone + texto, nunca só cor. */
export function AlertCard({ alert, onAction }: { alert: OverviewAlert; onAction?: () => void }) {
  const isAlert = alert.severity === 'alerta';
  const Icon = isAlert ? Warning : Info;
  return (
    <div className={`flex flex-col gap-1 rounded-lg px-4 py-3.5 ${isAlert ? 'bg-warn-bg' : 'bg-tint'}`}>
      <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${isAlert ? 'text-warn' : 'text-brand'}`}>
        <Icon size={16} aria-hidden />{isAlert ? 'Alerta' : 'Sinal'}
      </span>
      <span className="font-semibold">{alert.title}</span>
      <span className="text-ink-2 text-pretty">{alert.text}</span>
      <button type="button" onClick={onAction} className={`mt-1 inline-flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 font-semibold ${isAlert ? 'text-warn' : 'text-brand'}`}>
        {alert.cta}<ArrowRight size={14} aria-hidden />
      </button>
    </div>
  );
}
