'use client';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { ListMeta } from '@/lib/api/contracts';
import { formatNumber } from '@/lib/format';
import { Button } from './Button';

/** "1–25 de 412" e botões anterior/próxima. A contagem de páginas é só de navegação. */
export function Pagination({ meta, onPageChange }: { meta: ListMeta; onPageChange: (page: number) => void }) {
  const { page, pageSize, total } = meta;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 text-sm">
      <p aria-live="polite" className="text-muted tabular-nums">
        {total === 0 ? 'Nenhum resultado' : `${formatNumber(from)}–${formatNumber(to)} de ${formatNumber(total)}`}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior" icon={<CaretLeft size={14} aria-hidden />} />
        <span className="text-xs text-muted tabular-nums">Página {page} de {lastPage}</span>
        <Button variant="secondary" size="sm" disabled={page >= lastPage} onClick={() => onPageChange(page + 1)} aria-label="Próxima página" icon={<CaretRight size={14} aria-hidden />} />
      </div>
    </nav>
  );
}
