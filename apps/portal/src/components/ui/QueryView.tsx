'use client';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { isHiddenResource, type ApiError } from '@/lib/api/errors';
import { ComingSoonState, ErrorBanner, ErrorState, NotFoundState } from './States';

export interface QueryViewProps<T> {
  query: UseQueryResult<T, ApiError>;
  /** Esqueleto do tamanho real da tela. */
  loading: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** Objeto da frase de erro: "os atestados". */
  what: string;
  children: (data: T) => ReactNode;
}

/**
 * Cobre os estados de uma consulta: carregando, 403/404 (mesma tela), "em breve", erro com retry,
 * vazio e sucesso. Refetch que falha com dado antigo mantém o conteúdo e mostra um aviso acima.
 */
export function QueryView<T>({ query, loading, isEmpty, empty, what, children }: QueryViewProps<T>) {
  const { data, error } = query;
  if (error && isHiddenResource(error)) return <NotFoundState />;
  if (error?.kind === 'unavailable') return <ComingSoonState what={what} />;
  if (data === undefined) {
    if (query.isPending) return <>{loading}</>;
    return <ErrorState what={what} code={error?.code} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(data) && empty !== undefined) return <>{empty}</>;
  return (
    <>
      {query.isError && <ErrorBanner what={what} onRetry={() => void query.refetch()} />}
      {children(data)}
    </>
  );
}
