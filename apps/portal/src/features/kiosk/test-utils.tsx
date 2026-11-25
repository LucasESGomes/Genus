/** Apoio dos testes do totem: api falsa, armazenamento da chave em memória e provedores mínimos. */
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import type { KioskApi, KioskKeyStore } from '@/lib/api/kiosk';
import { fixedClock } from '@/lib/clock';
import { ClockProvider } from '@/lib/clock-context';
import { makeTestQueryClient } from '@/lib/query/client';

/** 21/11/2026 10:00 em São Paulo. */
export const KIOSK_NOW = '2026-11-21T13:00:00.000Z';

export const CONTEXT = {
  device: { id: '501', name: 'Totem da portaria' },
  establishment: { id: '1', name: 'Fazenda Boa Vista' },
  calibration: null,
  serverTime: KIOSK_NOW,
};

export function makeApi(over: Partial<KioskApi> = {}): KioskApi {
  return {
    context: vi.fn(async () => CONTEXT),
    enroll: vi.fn(async () => ({ enrolledAt: KIOSK_NOW, imagesProcessed: 3 })),
    submitCalibration: vi.fn(async () => ({ status: 'calculada' as const })),
    punch: vi.fn(async () => ({
      outcome: 'registered' as const,
      receiptId: '00000000-0000-4000-8000-000000000001',
      jobId: '501-1',
      markedAt: KIOSK_NOW,
      warnings: [],
      employeeFirstName: 'João',
    })),
    punchJob: vi.fn(),
    ...over,
  };
}

export function memoryKeyStore(initial: string | null = null): KioskKeyStore & { value: () => string | null } {
  let v = initial;
  return { get: () => v, set: (k) => void (v = k), clear: () => void (v = null), value: () => v };
}

export function renderKiosk(ui: ReactElement) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={makeTestQueryClient()}>
      <ClockProvider clock={fixedClock(KIOSK_NOW)}>{children}</ClockProvider>
    </QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

/** Câmera falsa: sempre pronta; `captureJpeg` devolve um Blob na hora. Use com vi.mock + vi.hoisted. */
export function fakeCameraHandle() {
  return {
    videoRef: { current: null },
    bindVideo: () => undefined,
    status: 'ready' as const,
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    grabLuminance: () => null,
    captureJpeg: vi.fn(async () => new Blob(['frame'], { type: 'image/jpeg' })),
  };
}
