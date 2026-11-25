'use client';
/** Uma instância da api por app (teste injeta a sua). */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { createRhApi, type RhApi } from './rh';

const ApiContext = createContext<RhApi | null>(null);

export function ApiProvider({ api, children }: { api?: RhApi; children: ReactNode }) {
  const [value] = useState(() => api ?? createRhApi());
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): RhApi {
  const v = useContext(ApiContext);
  if (!v) throw new Error('useApi fora do ApiProvider');
  return v;
}
