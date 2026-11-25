'use client';
import type { Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface BottomNavItem {
  href: string;
  label: string;
  icon: Icon;
}

/** Navegação inferior do portal do funcionário (mobile). Alvos de 56 px; item ativo com aria-current. */
/** `alwaysVisible`: também no desktop (portal do colaborador, preso à coluna central de 480 px). */
export function BottomNav({ items, className = '', alwaysVisible = false }: { items: BottomNavItem[]; className?: string; alwaysVisible?: boolean }) {
  const pathname = usePathname();
  // O item ativo é o de href mais específico que casa com a rota (`/me` não fica ativo em `/me/ponto`).
  const matches = items.filter(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  const current = matches.reduce<string | null>((best, { href }) => (best === null || href.length > best.length ? href : best), null);
  return (
    <nav aria-label="Navegação principal" className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white ${alwaysVisible ? 'md:left-1/2 md:right-auto md:w-[480px] md:-translate-x-1/2' : 'md:hidden'} ${className}`}>
      <ul className="m-0 flex list-none p-0">
        {items.map(({ href, label, icon: I }) => {
          const active = href === current;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? 'text-brand' : 'text-muted'}`}
              >
                <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-tint' : ''}`}>
                  <I size={22} weight={active ? 'fill' : 'regular'} aria-hidden />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
