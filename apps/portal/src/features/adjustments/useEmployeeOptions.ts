'use client';
/**
 * Colaboradores ativos do estabelecimento como opções de select. Mesma chave de cache do
 * `useEmployeeDirectory` (uma chamada só). Limite de 100 por página (lacuna do back, mapa §6).
 */
import type { SelectOption } from '@/components/ui/Fields';
import { useApiQuery } from '@/lib/query/hooks';
import { establishmentParam, useSession } from '@/lib/session';

export function useEmployeeOptions() {
  const { establishment } = useSession();
  const q = useApiQuery(
    'employees',
    { directory: true },
    async (api, signal) => (await api.employees.list({ establishmentId: establishmentParam(establishment), pageSize: 100 }, signal)).data,
    { staleTime: 5 * 60_000 },
  );
  const options: SelectOption[] = (q.data ?? [])
    .filter((e) => e.status === 'ativo')
    .map((e) => ({ value: e.id, label: e.registrationNumber ? `${e.name} · ${e.registrationNumber}` : e.name }));
  return { isPending: q.isPending, options };
}
