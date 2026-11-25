import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';

const SIZE = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' } as const;

/** Iniciais num círculo. Decorativo: o nome sempre aparece ao lado. */
export function Avatar({ name, size = 'md', className = '' }: { name: string; size?: keyof typeof SIZE; className?: string }) {
  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-tint font-bold text-brand', SIZE[size], className)}>
      {initials(name)}
    </span>
  );
}
