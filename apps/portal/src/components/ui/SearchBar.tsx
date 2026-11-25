'use client';
import { SearchInput } from './Fields';

/**
 * Campo de busca por texto das tabelas longas. O texto fica em estado de tela (nunca na URL: nome é dado pessoal);
 * quem usa envia à api só o valor com debounce (`useTextSearch`). Mostra "Buscando…" enquanto digita ou consulta.
 */
export function SearchBar({ label, placeholder, text, onTextChange, searching = false, className = 'max-w-[480px]' }: {
  label: string;
  placeholder: string;
  text: string;
  onTextChange: (text: string) => void;
  searching?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <SearchInput label={label} placeholder={placeholder} value={text} maxLength={100} onChange={(e) => onTextChange(e.target.value)} />
      <p role="status" aria-live="polite" className="m-0 min-h-4 text-xs text-muted">{searching ? 'Buscando…' : ''}</p>
    </div>
  );
}

/** "Nenhum resultado para …" sem repetir CPF ou outro número longo digitado. */
export function noResultsTitle(q: string): string {
  const trimmed = q.trim();
  const looksLikeDocument = trimmed.replace(/\D/g, '').length >= 6;
  return looksLikeDocument || trimmed.length > 40 ? 'Nenhum resultado para a busca' : `Nenhum resultado para “${trimmed}”`;
}
