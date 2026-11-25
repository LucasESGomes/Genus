'use client';
import type { ReactNode } from 'react';
import { BottomNav } from '@/components/domain';
import { PORTAL_NAV } from './copy';

/**
 * Moldura de cada aba do portal: cabeçalho, conteúdo e navegação inferior. Mobile first (390 px, funciona em 360);
 * no desktop a coluna já fica centralizada pelo layout de /me, e a navegação acompanha essa coluna.
 */
export function PortalFrame({ title, eyebrow, subtitle, children }: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <>
      <main className="flex flex-col gap-4 px-5 pb-28 pt-6">
        <header className="flex flex-col gap-0.5">
          {eyebrow && <span className="text-sm text-muted">{eyebrow}</span>}
          <h1 className="m-0 text-[28px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
          {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
        </header>
        {children}
      </main>
      <BottomNav items={PORTAL_NAV} alwaysVisible />
    </>
  );
}
