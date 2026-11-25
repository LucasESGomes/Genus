'use client';
/**
 * Filtros e seleção na URL (compartilhável e recarregável). Só valores não sensíveis:
 * datas, status, abas, IDs opacos, página. NUNCA nome, CPF, e-mail, matrícula ou dado de saúde.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

export function useUrlState<K extends string>(keys: readonly K[]) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const signature = keys.join('|');
  const values = useMemo(() => {
    const out = {} as Record<K, string | null>;
    for (const k of signature.split('|') as K[]) out[k] = params.get(k);
    return out;
  }, [params, signature]);

  /** Atualiza só as chaves dadas; `null`/'' remove. Usa replace (não polui o histórico com filtros). */
  const set = useCallback(
    (patch: Partial<Record<K, string | number | null>>, opts: { push?: boolean } = {}) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch) as [K, string | number | null | undefined][]) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      const s = next.toString();
      const url = s ? `${pathname}?${s}` : pathname;
      if (opts.push) router.push(url, { scroll: false });
      else router.replace(url, { scroll: false });
    },
    [params, pathname, router],
  );

  return [values, set] as const;
}

/** Lê um valor de enumeração da URL; fora da lista → padrão. */
export function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}
