import Link from 'next/link';
import type { ReactNode } from 'react';

/** Link com a aparência do botão secundário (navegação, não ação). */
export function LinkButton({ href, children, icon }: { href: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line-strong bg-white px-[18px] font-semibold hover:bg-surface"
    >
      {icon}
      {children}
    </Link>
  );
}
