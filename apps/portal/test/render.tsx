/**
 * Render de teste com todos os provedores. Uso típico:
 *
 *   const { api } = renderWithSession(<CertificatesScreen />, {
 *     role: 'admin',
 *     api: { certificates: { list: vi.fn(async () => page) } },
 *     route: '/rh/atestados?aba=pendente',
 *   });
 *   expect(api.certificates.list).toHaveBeenCalledWith(...)
 *
 * `api` parte do mock completo (createMockApi) e troca só os métodos passados.
 */
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { Providers } from '@/app/providers';
import type { Establishment, Me, Role } from '@/lib/api/contracts';
import { mockEstablishments, mockMeFor } from '@/lib/api/mocks';
import { createMockApi, type RhApi } from '@/lib/api/rh';
import { fixedClock } from '@/lib/clock';
import { makeTestQueryClient } from '@/lib/query/client';
import { SessionProvider } from '@/lib/session';
import { setRoute } from './navigation';

export type ApiOverrides = { [K in keyof RhApi]?: Partial<RhApi[K]> };

export function buildApi(overrides: ApiOverrides = {}): RhApi {
  const base = createMockApi();
  const out = { ...base } as Record<keyof RhApi, object>;
  for (const k of Object.keys(overrides) as (keyof RhApi)[]) {
    // O mock base pode ser um Proxy ("Em breve"); o override vence, o resto cai no base.
    const baseModule = base[k] as object;
    const over = overrides[k] as object;
    out[k] = new Proxy(over, { get: (t, p) => (p in t ? Reflect.get(t, p) : Reflect.get(baseModule, p)) });
  }
  return out as RhApi;
}

/** "Agora" padrão dos testes: 21/11/2026 10:00 em São Paulo (dia de referência do design). */
export const TEST_NOW = '2026-11-21T13:00:00.000Z';

export function renderWithSession(ui: ReactElement, opts: {
  role?: Exclude<Role, 'super_admin'>;
  me?: Partial<Me>;
  api?: ApiOverrides;
  establishments?: Establishment[];
  route?: string;
  now?: string;
} & Omit<RenderOptions, 'wrapper'> = {}) {
  const { role = 'rh', me: meOver, api: apiOver, establishments = mockEstablishments, route, now = TEST_NOW, ...rest } = opts;
  if (route) setRoute(route);
  const me: Me = { ...mockMeFor(role), ...meOver };
  const api = buildApi(apiOver);
  const queryClient = makeTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Providers api={api} clock={fixedClock(now)} queryClient={queryClient}>
      <SessionProvider me={me} establishments={establishments} api={api}>{children}</SessionProvider>
    </Providers>
  );
  return { ...render(ui, { wrapper: Wrapper, ...rest }), api, me, queryClient };
}
