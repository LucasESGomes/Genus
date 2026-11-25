'use client';
/**
 * Seletor de estabelecimento: popover com lista (listbox). Só mostra o que `useSession()` já filtrou
 * pelo escopo do usuário. Teclado: setas, Home e End movem; Enter escolhe; Esc fecha e devolve o foco ao botão.
 */
import { Buildings, CaretUpDown, Check } from '@phosphor-icons/react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
import { useSession } from '@/lib/session';

export function EstablishmentSelect({ compact = false }: { compact?: boolean }) {
  const { establishments, establishment, setEstablishmentId } = useSession();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const single = establishments.length < 2;

  const options = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = options();
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (at <= 0 ? items.length : at) - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next]?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={single ? `Estabelecimento: ${establishment.name}` : `Estabelecimento: ${establishment.name}. Trocar`}
          disabled={single}
          className={`flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-md border border-line bg-surface text-left hover:border-line-hover disabled:cursor-default ${compact ? 'justify-center py-2' : 'px-3 py-2'}`}
        >
          <Buildings size={20} className="shrink-0 text-brand" aria-hidden />
          {!compact && (
            <>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{establishment.name}</span>
                {establishment.subtitle && <span className="text-xs text-muted">{establishment.subtitle}</span>}
              </span>
              {!single && <CaretUpDown size={16} className="text-muted" aria-hidden />}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={compact ? 'right' : 'bottom'}
        aria-label="Escolher estabelecimento"
        className="w-[232px] rounded-lg border-line p-1.5 shadow-pop"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
          (selected ?? options()[0])?.focus();
        }}
      >
        <div className="px-2.5 py-1.5 text-xs text-muted" aria-hidden>Estabelecimentos</div>
        <div ref={listRef} role="listbox" aria-label="Estabelecimentos" onKeyDown={onKeyDown} className="flex flex-col">
          {establishments.map((e) => {
            const selected = e.id === establishment.id;
            return (
              <button
                key={e.id || 'all'}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setEstablishmentId(e.id);
                  setOpen(false);
                }}
                className={`flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2.5 py-2 text-left hover:bg-surface ${selected ? 'bg-surface' : 'bg-transparent'}`}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{e.name}</span>
                  {e.subtitle && <span className="text-xs text-muted">{e.subtitle}</span>}
                </span>
                {selected && <Check size={16} className="shrink-0 text-brand" aria-hidden />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
