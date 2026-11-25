'use client';
/** Peças das telas de auditoria, acessos e reconhecimento: campos de filtro ligados à URL, período e lista com cursor. */
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import type { Icon } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Fields';
import { ErrorBanner, ErrorState, Skeleton, EmptyState } from '@/components/ui/States';
import { Input } from '@/components/ui/shadcn/input';
import type { ApiError } from '@/lib/api/errors';
import type { CursorPage } from '@/lib/api/super-admin-contracts';
import { addCivilDays, DEFAULT_TZ } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';
import { friendlyError } from './parts';

export interface NativeOption {
  value: string;
  label: string;
}

/** Select nativo com rótulo: teclado e leitor de tela funcionam sem script. */
export function NativeSelect({ label, value, onChange, options, allLabel = 'Todos', id }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: NativeOption[];
  allLabel?: string;
  id?: string;
}) {
  return (
    <Field label={label} id={id}>
      {(c) => (
        <select
          {...c}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-full min-w-0 rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">{allLabel}</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  );
}

/**
 * Campo de texto que grava na URL depois de uma pausa na digitação. Se a URL muda por fora
 * (ex.: clique num IP), o campo acompanha.
 */
export function UrlTextInput({ label, value, onCommit, placeholder, inputMode, sanitize, hint }: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
  sanitize?: (raw: string) => string;
  hint?: string;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text.trim());
  const commit = useRef(onCommit);
  commit.current = onCommit;
  const committed = useRef(value);
  useEffect(() => {
    if (debounced === committed.current) return;
    committed.current = debounced;
    commit.current(debounced);
  }, [debounced]);
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setText(value);
  }, [value]);
  return (
    <Field label={label} hint={hint}>
      {(c) => (
        <Input {...c} value={text} placeholder={placeholder} inputMode={inputMode} autoComplete="off" onChange={(e) => setText(sanitize ? sanitize(e.target.value) : e.target.value)} className="h-10 bg-white" />
      )}
    </Field>
  );
}

export const digitsOnly = (raw: string) => raw.replace(/\D/g, '').slice(0, 18);

const ISO_PATTERN = "yyyy-MM-dd'T'HH:mm:ssXXX";
/** Dia civil (AAAA-MM-DD) → início do dia no fuso do painel, em ISO com deslocamento. */
export const dayStartIso = (civil: string) => formatInTimeZone(fromZonedTime(`${civil}T00:00:00`, DEFAULT_TZ), DEFAULT_TZ, ISO_PATTERN);

export const MAX_RANGE_DAYS = 90;
export const RANGE_ERRORS = {
  tooLong: `O período pode ter no máximo ${MAX_RANGE_DAYS} dias.`,
  inverted: 'A data inicial não pode ser depois da data final.',
} as const;

export interface RangeResult {
  from?: string;
  to?: string;
  error?: string;
}

/** `to` é exclusivo na api: o dia final entra inteiro, então vale o início do dia seguinte. */
export function rangeToIso(fromDay: string, toDay: string): RangeResult {
  const out: RangeResult = {};
  if (fromDay) out.from = dayStartIso(fromDay);
  if (toDay) out.to = dayStartIso(addCivilDays(toDay, 1));
  if (out.from && out.to) {
    const days = (Date.parse(out.to) - Date.parse(out.from)) / 86_400_000;
    if (days <= 0) out.error = RANGE_ERRORS.inverted;
    else if (days > MAX_RANGE_DAYS) out.error = RANGE_ERRORS.tooLong;
  }
  return out;
}

export function RangeError({ message }: { message: string }) {
  return <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{message}</p>;
}

export function FilterBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <form role="search" aria-label={label} onSubmit={(e) => e.preventDefault()} className="grid gap-3 rounded-card border border-line bg-white p-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
      {children}
    </form>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-2 rounded-card border border-line bg-white p-4">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  );
}

/**
 * Estados de uma lista com cursor: carregando, erro com retry, vazio e dados com "Carregar mais".
 * Falha ao buscar mais com dados na tela mantém a lista e mostra o aviso.
 */
export function InfiniteView<T>({ query, what, empty, emptyIcon, children }: {
  query: UseInfiniteQueryResult<InfiniteData<CursorPage<T>, unknown>, ApiError>;
  what: string;
  empty: { title: string; description: string };
  emptyIcon: Icon;
  children: (rows: T[]) => ReactNode;
}) {
  if (query.data === undefined) {
    if (query.isPending && query.fetchStatus !== 'idle') return <TableSkeleton />;
    if (query.isPending) return null;
    return <ErrorState what={what} code={query.error ? friendlyError(query.error).code : undefined} onRetry={() => void query.refetch()} />;
  }
  const rows = query.data.pages.flatMap((p) => p.data);
  if (rows.length === 0) return <EmptyState icon={emptyIcon} title={empty.title} text={empty.description} />;
  return (
    <div className="flex flex-col gap-3">
      {query.isError && <ErrorBanner what={what} onRetry={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())} />}
      {children(rows)}
      <div className="flex justify-center">
        {query.hasNextPage
          ? <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>Carregar mais</Button>
          : <p className="m-0 text-sm text-muted">Fim da lista.</p>}
      </div>
    </div>
  );
}
