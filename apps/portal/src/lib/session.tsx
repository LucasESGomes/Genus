'use client';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Establishment, Me } from './api/contracts';
import { createRhApi, type RhApi } from './api/rh';

interface SessionValue {
  me: Me;
  api: RhApi;
  establishments: Establishment[];
  establishment: Establishment;
  setEstablishmentId: (id: number) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ me, establishments, api, children }: { me: Me; establishments: Establishment[]; api?: RhApi; children: ReactNode }) {
  const [id, setEstablishmentId] = useState(establishments[0]?.id ?? 0);
  const value = useMemo<SessionValue>(() => ({
    me, api: api ?? createRhApi(), establishments,
    establishment: establishments.find((e) => e.id === id) ?? establishments[0] ?? { id: 0, name: '—', subtitle: '' },
    setEstablishmentId,
  }), [me, api, establishments, id]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession fora do SessionProvider');
  return v;
}
