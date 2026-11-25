import { ArrowSquareOut } from '@phosphor-icons/react/dist/ssr';
import { COPY } from './copy';

/** Abre a página pública do totem (`/totem`) em outra aba. A chave do aparelho é digitada lá, nunca passa pela URL. */
export function OpenTotemLink({ className = '' }: { className?: string }) {
  return (
    <a
      href="/totem"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line-strong bg-white px-[18px] font-semibold text-ink no-underline hover:bg-surface ${className}`}
    >
      <ArrowSquareOut size={18} aria-hidden />
      {COPY.openTotem.label}
      <span className="sr-only"> (abre em outra aba)</span>
    </a>
  );
}
