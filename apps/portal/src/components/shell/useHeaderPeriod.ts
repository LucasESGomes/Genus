'use client';
/**
 * Período do cabeçalho da página, guardado na URL (`from` e `to`, AAAA-MM-DD; nada sensível).
 * Padrão: do dia 1 do mês até hoje, pelo Clock. Valor inválido na URL cai no padrão.
 * Uso: `const { period, setPeriod } = useHeaderPeriod()` e `<PageHeader periodValue={period} onPeriodChange={setPeriod} />`.
 */
import { useCallback, useMemo } from 'react';
import type { Period } from '@/components/ui/PeriodPicker';
import { useClock } from '@/lib/clock-context';
import { monthOf, todayCivil } from '@/lib/format';
import { useUrlState } from '@/lib/url-state';

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ['from', 'to'] as const;

export function useHeaderPeriod() {
  const clock = useClock();
  const today = todayCivil(clock);
  const [values, set] = useUrlState(KEYS);
  const { from, to } = values;

  const period = useMemo<Period>(() => {
    if (from && to && CIVIL.test(from) && CIVIL.test(to) && from <= to) return { from, to };
    return { from: `${monthOf(today)}-01`, to: today };
  }, [from, to, today]);

  const setPeriod = useCallback((p: Period) => set({ from: p.from, to: p.to }), [set]);

  return { period, setPeriod };
}
