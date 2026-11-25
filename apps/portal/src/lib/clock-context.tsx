'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { systemClock, type Clock } from './clock';

const ClockContext = createContext<Clock>(systemClock);

export function ClockProvider({ clock, children }: { clock: Clock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

/** Hora atual para telas: `useClock().now()`. Nunca `new Date()` em componente. */
export const useClock = () => useContext(ClockContext);
