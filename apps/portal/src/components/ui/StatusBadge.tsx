import { cn } from '@/lib/utils';
import { CheckCircle, Info, MinusCircle, WarningCircle, WarningOctagon } from '@phosphor-icons/react/dist/ssr';
import type { Icon } from '@phosphor-icons/react';
import type { LabelTone } from '@/lib/labels';

const TONE: Record<LabelTone, { icon: Icon; cls: string }> = {
  good: { icon: CheckCircle, cls: 'bg-good-bg text-good' },
  warn: { icon: WarningCircle, cls: 'bg-warn-bg text-warn' },
  danger: { icon: WarningOctagon, cls: 'bg-danger-bg text-danger' },
  neutral: { icon: MinusCircle, cls: 'bg-surface text-ink-2 border border-line' },
  info: { icon: Info, cls: 'bg-tint text-brand' },
};

/** Estado em texto + ícone por tom (nunca só cor). `label` e `tone` vêm de `lib/labels`. */
export function StatusBadge({ label, tone, className = '' }: { label: string; tone: LabelTone; className?: string }) {
  const { icon: I, cls } = TONE[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', cls, className)}>
      <I size={14} weight="fill" aria-hidden />
      {label}
    </span>
  );
}
