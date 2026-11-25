'use client';
/** Provedores globais: react-query (cache só em memória), api, relógio, tooltip e toasts. */
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/shadcn/tooltip';
import { Toaster } from '@/components/ui/shadcn/sonner';
import { ApiProvider } from '@/lib/api/provider';
import type { RhApi } from '@/lib/api/rh';
import { fixedClock, systemClock, type Clock } from '@/lib/clock';
import { useMocks } from '@/lib/api/mocks/runtime';
import { ClockProvider } from '@/lib/clock-context';
import { makeQueryClient } from '@/lib/query/client';
import type { QueryClient } from '@tanstack/react-query';

/** Modo mock: o "hoje" fica em 21/11/2026 (dia de referência do design e dos dados de demonstração). */
const MOCK_NOW = '2026-11-21T13:00:00.000Z';
// Calculado uma vez: a variável de ambiente é fixa no build, e um relógio novo a cada render re-renderizaria tudo.
const DEFAULT_CLOCK: Clock = useMocks() ? fixedClock(MOCK_NOW) : systemClock;

export function Providers({ children, api, clock = DEFAULT_CLOCK, queryClient }: {
  children: ReactNode;
  api?: RhApi;
  clock?: Clock;
  queryClient?: QueryClient;
}) {
  const [client] = useState(() => queryClient ?? makeQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ApiProvider api={api}>
        <ClockProvider clock={clock}>
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ClockProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
