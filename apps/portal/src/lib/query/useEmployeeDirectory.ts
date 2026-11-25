'use client';
/**
 * Nomes e matrículas dos colaboradores do estabelecimento, para telas cujas listas só trazem
 * `employeeId` (atestados, ajustes). Uma chamada por estabelecimento (cache), sem buscar por ID.
 * Lacuna do back (portal-mapa-front §6 item 8): a api deveria mandar nome/matrícula/setor na lista.
 * Limite: 100 por página na api; acima disso, os nomes faltantes aparecem como "Colaborador".
 */
import type { EntityId } from '../api/contracts';
import { establishmentParam, useSession } from '../session';
import { useApiQuery } from './hooks';

export interface DirectoryEntry {
  name: string;
  registrationNumber: string | null;
}

export function useEmployeeDirectory() {
  const { establishment } = useSession();
  const q = useApiQuery(
    'employees',
    { directory: true },
    async (api, signal) => (await api.employees.list({ establishmentId: establishmentParam(establishment), pageSize: 100 }, signal)).data,
    { staleTime: 5 * 60_000 },
  );
  const byId = new Map<EntityId, DirectoryEntry>((q.data ?? []).map((e) => [e.id, { name: e.name, registrationNumber: e.registrationNumber }]));
  return {
    isPending: q.isPending,
    /** Nunca lança: sem o nome, mostra um rótulo genérico (sem expor o ID na tela). */
    lookup: (id: EntityId): DirectoryEntry => byId.get(id) ?? { name: 'Colaborador', registrationNumber: null },
  };
}
