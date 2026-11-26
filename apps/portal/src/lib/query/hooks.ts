'use client';
/**
 * Hooks de dados. Toda tela usa `useApiQuery`/`useApiMutation`: a chave de cache já vem com
 * [tenant, usuário, estabelecimento, módulo, parâmetros], e a função recebe a api da sessão.
 * Não iterar IDs nem pré-carregar "o próximo" (sem enumeração).
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ApiError } from '../api/errors';
import type { RhApi } from '../api/rh';
import { useScopeKey, useSession } from '../session';

/** Módulos de cache. Invalidar um módulo invalida todas as consultas dele no escopo atual. */
export type CacheModule =
  | 'overview' | 'org' | 'employees' | 'assignments' | 'schedules' | 'timesheets' | 'day' | 'adjustments' | 'absences'
  | 'certificates' | 'analyses' | 'vacations' | 'vacationCalendar' | 'closings' | 'mirrors' | 'timeBank'
  | 'me' | 'devices' | 'calibration' | 'admin' | 'invites';

export function useApiQuery<T>(
  module: CacheModule,
  params: Record<string, unknown> | readonly unknown[],
  fn: (api: RhApi, signal: AbortSignal) => Promise<T>,
  options: Omit<UseQueryOptions<T, ApiError, T, readonly unknown[]>, 'queryKey' | 'queryFn'> = {},
) {
  const { api } = useSession();
  const scope = useScopeKey();
  const queryKey = useMemo(() => [...scope, module, params] as const, [scope, module, params]);
  return useQuery<T, ApiError, T, readonly unknown[]>({ queryKey, queryFn: ({ signal }) => fn(api, signal), ...options });
}

/** Invalida módulos inteiros no escopo atual (ex.: aprovar ajuste → ['adjustments', 'timesheets', 'day']). */
export function useInvalidate() {
  const qc = useQueryClient();
  const scope = useScopeKey();
  return (...modules: CacheModule[]) =>
    Promise.all(modules.map((m) => qc.invalidateQueries({ queryKey: [...scope, m] })));
}

export function useApiMutation<TVars, TResult>(
  fn: (api: RhApi, vars: TVars) => Promise<TResult>,
  opts: { invalidates?: CacheModule[]; onSuccess?: (r: TResult, vars: TVars) => void; onError?: (e: ApiError, vars: TVars) => void } = {},
) {
  const { api } = useSession();
  const invalidate = useInvalidate();
  return useMutation<TResult, ApiError, TVars>({
    mutationFn: (vars) => fn(api, vars),
    onSuccess: async (r, vars) => {
      if (opts.invalidates?.length) await invalidate(...opts.invalidates);
      opts.onSuccess?.(r, vars);
    },
    onError: (e, vars) => opts.onError?.(e, vars),
  });
}
