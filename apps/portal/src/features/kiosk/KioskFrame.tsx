'use client';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import { cn } from '@/lib/utils';
import { COPY } from './copy';

/** Moldura de tela cheia do totem: sem menu lateral, alto contraste, conteúdo centralizado (mobile primeiro). */
export function KioskFrame({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2" aria-label={COPY.brand}>
          <BrandMark />
          <span className="text-lg font-bold tracking-[-0.01em]">{COPY.brand}</span>
        </div>
        {action}
      </header>
      <main className={cn('mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pb-8 sm:max-w-xl', className)}>{children}</main>
    </div>
  );
}

/** Classes dos botões grandes (alvo ≥ 56 px, texto legível de longe). */
export const BIG_BUTTON = 'h-14 w-full text-lg';
