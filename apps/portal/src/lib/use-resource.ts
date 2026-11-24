'use client';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api/errors';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  | { status: 'success'; data: T };

/** Busca um recurso com cancelamento e "tentar de novo". A tela só renderiza o estado. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<Resource<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ status: 'loading' });
    load(ctrl.signal).then(
      (data) => !ctrl.signal.aborted && setState({ status: 'success', data }),
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: 'error', error: e instanceof ApiError ? e : new ApiError('server', 0, 'UNKNOWN', 'Erro inesperado') });
      },
    );
    return () => ctrl.abort();
  }, [...deps, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
