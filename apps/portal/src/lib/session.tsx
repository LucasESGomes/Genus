'use client';
/**
 * Sessão do portal: `me`, api, estabelecimentos do escopo e o estabelecimento selecionado.
 * - O seletor só oferece `me.establishmentScope` (null = todos da conta).
 * - Trocar de estabelecimento LIMPA o cache inteiro (nada de dado de outro estabelecimento em tela).
 * - Chaves de cache dos dados começam com ['genus', tenant, usuário, estabelecimento] (`useScopeKey`);
 *   as da sessão (me, estabelecimentos) ficam em ['genus-session', …] e sobrevivem à troca.
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { EntityId, Establishment, Me } from './api/contracts';
import { createRhApi, type RhApi } from './api/rh';

/** Sem GET /portal/establishments e com escopo da conta inteira: um item sintético "todos". */
export const ALL_ESTABLISHMENTS: Establishment = { id: '', name: 'Todos os estabelecimentos', subtitle: 'Conta inteira' };

/** `establishmentId` para query string: undefined quando é "todos". */
export const establishmentParam = (e: Establishment): EntityId | undefined => (e.id === '' ? undefined : e.id);

interface SessionValue {
  me: Me;
  api: RhApi;
  establishments: Establishment[];
  establishment: Establishment;
  setEstablishmentId: (id: EntityId) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

const PREF_KEY = (me: Me) => `genus.ui.establishment.${me.tenantId ?? '-'}.${me.id}`;

/** Só os estabelecimentos do escopo do usuário, mesmo que a lista traga outros. */
export function scopeEstablishments(me: Me, all: Establishment[]): Establishment[] {
  if (me.establishmentScope === null) return all.length ? all : [ALL_ESTABLISHMENTS];
  const scope = new Set(me.establishmentScope);
  const known = all.filter((e) => scope.has(e.id));
  // Sem a lista do back: monta pelos ids do escopo (nome genérico, sem inventar dado).
  return known.length ? known : me.establishmentScope.map((id) => ({ id, name: `Estabelecimento ${id}`, subtitle: '' }));
}

function readPreference(me: Me): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(PREF_KEY(me));
  } catch {
    return null;
  }
}

export function SessionProvider({ me, establishments, api, initialEstablishmentId, children }: {
  me: Me;
  establishments: Establishment[];
  api?: RhApi;
  /** Da URL (`?establishmentId=`); ignorado se estiver fora do escopo. */
  initialEstablishmentId?: string | null;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const allowed = useMemo(() => scopeEstablishments(me, establishments), [me, establishments]);
  const [id, setId] = useState<string>(() => {
    const wanted = [initialEstablishmentId, readPreference(me)].find((v) => v != null && allowed.some((e) => e.id === v));
    return wanted ?? allowed[0]?.id ?? '';
  });

  const setEstablishmentId = useCallback(
    (next: EntityId) => {
      if (!allowed.some((e) => e.id === next) || next === id) return;
      // Troca de escopo: nada do estabelecimento anterior fica em cache.
      queryClient.removeQueries({ queryKey: ['genus'] });
      try {
        window.localStorage.setItem(PREF_KEY(me), next);
      } catch {
        /* preferência de UI: pode falhar sem efeito */
      }
      setId(next);
    },
    [allowed, id, me, queryClient],
  );

  const value = useMemo<SessionValue>(
    () => ({
      me,
      api: api ?? createRhApi(),
      establishments: allowed,
      establishment: allowed.find((e) => e.id === id) ?? allowed[0] ?? ALL_ESTABLISHMENTS,
      setEstablishmentId,
    }),
    [me, api, allowed, id, setEstablishmentId],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession fora do SessionProvider');
  return v;
}

/** Prefixo de toda chave de cache: ['genus', tenant, usuário, estabelecimento]. */
export function useScopeKey(): readonly unknown[] {
  const { me, establishment } = useSession();
  return useMemo(() => ['genus', me.tenantId, me.id, establishment.id] as const, [me.tenantId, me.id, establishment.id]);
}
