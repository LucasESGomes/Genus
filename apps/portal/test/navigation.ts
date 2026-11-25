/**
 * Mock de next/navigation para Vitest (ligado em test/setup.ts). O teste controla rota e query
 * com `setRoute('/rh/atestados?aba=pendente')` e confere navegação com `router.replace/push`.
 * `usePathname`/`useSearchParams` assinam a "URL" (useSyncExternalStore): `router.replace` re-renderiza.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { vi } from 'vitest';

let url = '/rh';
const listeners = new Set<() => void>();

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => url;

const apply = (next: string) => {
  url = next.startsWith('/') ? next : `/${next}`;
  listeners.forEach((l) => l());
};

export const router = {
  push: vi.fn((next: string) => apply(next)),
  replace: vi.fn((next: string) => apply(next)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

/** Define a rota atual (antes do render ou durante o teste) e zera os espiões do router. */
export function setRoute(next: string) {
  apply(next);
  router.push.mockClear();
  router.replace.mockClear();
}

/** Rota atual (para conferir o efeito de router.replace). */
export const currentRoute = () => url;

function usePathname() {
  const u = useSyncExternalStore(subscribe, snapshot, snapshot);
  return u.split('?')[0] || '/';
}

function useSearchParams() {
  const u = useSyncExternalStore(subscribe, snapshot, snapshot);
  const q = u.split('?')[1] ?? '';
  return useMemo(() => new URLSearchParams(q), [q]);
}

export const navigationMock = {
  useRouter: () => router,
  usePathname,
  useSearchParams,
  useParams: () => ({}),
  redirect: vi.fn(),
  notFound: vi.fn(),
};
