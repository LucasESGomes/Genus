'use client';
import { useRef, type KeyboardEvent } from 'react';
import { formatNumber } from '@/lib/format';

export interface CountTab<V extends string> {
  value: V;
  label: string;
  count?: number;
  /** Ponto de destaque: há algo novo/pendente nesta aba. */
  attention?: boolean;
}

/** Abas com contagem. As setas movem o foco e a seleção; quem usa mostra o conteúdo da aba ativa. */
export function CountTabs<V extends string>({ items, value, onChange, label }: { items: CountTab<V>[]; value: V; onChange: (value: V) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, index: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const target = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : step ? (index + step + items.length) % items.length : -1;
    if (target < 0) return;
    e.preventDefault();
    const next = items[target];
    if (next) {
      onChange(next.value);
      refs.current[target]?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((it, i) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(it.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px inline-flex min-h-11 shrink-0 focus-visible:outline-offset-[-2px] cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${active ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {it.label}
            {it.count !== undefined && (
              <span className={`rounded-full px-2 py-0.5 text-xs tabular-nums ${active ? 'bg-brand text-white' : 'bg-tint text-ink-2'}`}>{formatNumber(it.count)}</span>
            )}
            {it.attention && (
              <>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span className="sr-only">requer atenção</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
