'use client';
import { ArrowDown, ArrowUp } from '@phosphor-icons/react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Skeleton } from './States';

export interface DataTableProps<T> {
  // `never` no valor da coluna: aceita colunas com `accessorKey`/`accessorFn` de qualquer tipo.
  columns: ColumnDef<T, never>[];
  data: T[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Nome acessível da linha clicável ("Abrir atestado de Maria"). */
  rowLabel?: (row: T) => string;
  selectedId?: string | null;
  /** Mostra N linhas de esqueleto no lugar dos dados. */
  loadingRows?: number;
  /** Conteúdo quando `data` está vazio (ex.: `EmptyState`). */
  empty?: ReactNode;
  footer?: ReactNode;
  /** Título da tabela para leitor de tela (fica oculto). */
  caption: string;
  /** Ordenação no cliente, só para listas inteiras em memória. Colunas com `enableSorting: false` ficam de fora. */
  sortable?: boolean;
}

/** Tabela semântica; linha clicável também por teclado (Enter/Espaço); linha selecionada leva `aria-current`. */
export function DataTable<T>({ columns, data, getRowId, onRowClick, rowLabel, selectedId, loadingRows, empty, footer, caption, sortable = false }: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable<T>({
    // ColumnDef<T, never> → ColumnDef<T, unknown>: variância dos tipos do TanStack (o valor da célula não é usado aqui).
    columns: columns as unknown as ColumnDef<T, unknown>[],
    data,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    ...(sortable ? { getSortedRowModel: getSortedRowModel(), state: { sorting }, onSortingChange: setSorting } : { enableSorting: false }),
  });
  const colCount = columns.length;
  const loading = loadingRows !== undefined && loadingRows > 0;
  const rows = table.getRowModel().rows;

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
    }
  };

  return (
    <div className="overflow-hidden rounded-card border border-line bg-white shadow-card">
      {/* Região rolável focável: no celular a tabela rola na horizontal e precisa ser alcançável pelo teclado. */}
      <div className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-brand" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-surface">
                {hg.headers.map((h) => {
                  const dir = h.column.getIsSorted();
                  const can = sortable && h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      scope="col"
                      aria-sort={can ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                      className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-muted"
                    >
                      {h.isPlaceholder ? null : can ? (
                        <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex cursor-pointer items-center gap-1 font-semibold">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === 'asc' && <ArrowUp size={12} aria-hidden />}
                          {dir === 'desc' && <ArrowDown size={12} aria-hidden />}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`sk-${i}`} aria-hidden className="h-14 border-b border-line-soft last:border-b-0">
                  {columns.map((_c, j) => (
                    <td key={j} className="px-4 py-2"><Skeleton className="h-3.5 w-[70%]" /></td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row) => {
                const selected = selectedId != null && row.id === selectedId;
                const clickable = onRowClick !== undefined;
                return (
                  <tr
                    key={row.id}
                    tabIndex={clickable ? 0 : undefined}
                    aria-current={selected ? 'true' : undefined}
                    aria-label={clickable ? rowLabel?.(row.original) : undefined}
                    onClick={clickable ? () => onRowClick(row.original) : undefined}
                    onKeyDown={clickable ? (e) => onKey(e, row.original) : undefined}
                    className={`h-14 border-b border-line-soft last:border-b-0 ${clickable ? 'cursor-pointer hover:bg-surface' : ''} ${selected ? 'bg-tint/40 [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-accent)]' : ''}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2 align-middle">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                );
              })}
            {!loading && rows.length === 0 && empty !== undefined && (
              <tr><td colSpan={colCount} className="p-0">{empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
    </div>
  );
}
