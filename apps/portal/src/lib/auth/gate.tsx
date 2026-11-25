'use client';
/**
 * Guarda de área. Carrega `me`, decide pelo papel e monta a sessão. É conveniência de tela:
 * a segurança é a api (401/403/404 em toda rota).
 * - Sem sessão (401) → /login?next=<rota atual> (só o caminho, nunca dado da tela).
 * - Área `rh`: papéis de `rh.panel`. Colaborador vai para /me; os demais veem 403.
 * - Área `me`: só `colaborador`; os demais veem 403.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ErrorState, ForbiddenState, LoadingState } from '@/components/ui/States';
import type { Establishment, Me } from '../api/contracts';
import { ApiError } from '../api/errors';
import { useApi } from '../api/provider';
import { SessionProvider } from '../session';
import { can, homeFor } from './permissions';

export const SESSION_KEY = ['genus-session'] as const;

/** Saída em andamento: a guarda desmonta o conteúdo e para as próprias consultas antes de limpar o cache. */
const SignOutContext = createContext<(() => void) | null>(null);

/** Só caminhos internos do portal entram no `next` (evita redirecionamento aberto). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return /^\/(rh|me)(\/|$|\?)/.test(next) ? next : null;
}

export function AuthGate({ area, children }: { area: 'rh' | 'me'; children: ReactNode }) {
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [signingOut, setSigningOut] = useState(false);
  const beginSignOut = useCallback(() => setSigningOut(true), []);

  const me = useQuery<Me, ApiError>({
    queryKey: [...SESSION_KEY, 'me'],
    queryFn: ({ signal }) => api.auth.me(signal),
    staleTime: 5 * 60_000,
    enabled: !signingOut,
  });
  const establishments = useQuery<Establishment[], ApiError>({
    queryKey: [...SESSION_KEY, 'establishments', me.data?.tenantId, me.data?.id],
    // Sem o endpoint (Em breve): a sessão monta a lista pelo escopo do usuário.
    queryFn: ({ signal }) => api.org.establishments(signal).catch((e: unknown) => {
      if (e instanceof ApiError && e.kind === 'unavailable') return [];
      throw e;
    }),
    enabled: Boolean(me.data) && !signingOut,
    staleTime: 10 * 60_000,
  });

  const unauthenticated = me.error?.kind === 'unauthenticated';
  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, pathname, router]);

  const role = me.data?.role;
  const wrongArea = role !== undefined && (area === 'rh' ? role === 'colaborador' : false);
  useEffect(() => {
    if (wrongArea && role) router.replace(homeFor(role));
  }, [wrongArea, role, router]);

  if (signingOut) return <div className="p-8"><LoadingState label="Saindo…" /></div>;
  if (me.isPending || unauthenticated || wrongArea) return <div className="p-8"><LoadingState label="Carregando sessão…" /></div>;
  if (me.isError) return <div className="p-8"><ErrorState what="a sua sessão" code={me.error.code} onRetry={() => void me.refetch()} /></div>;

  const allowed = area === 'rh' ? can(me.data.role, 'rh.panel') : can(me.data.role, 'employee.portal');
  if (!allowed) {
    return (
      <div className="p-8">
        <ForbiddenState screen={area === 'rh' ? 'o painel de RH' : 'o portal do colaborador'} establishment="esta conta" />
      </div>
    );
  }
  if (establishments.isPending) return <div className="p-8"><LoadingState label="Carregando estabelecimentos…" /></div>;
  if (establishments.isError) {
    return <div className="p-8"><ErrorState what="os estabelecimentos" code={establishments.error.code} onRetry={() => void establishments.refetch()} /></div>;
  }

  return (
    <SignOutContext.Provider value={beginSignOut}>
      <SessionProvider me={me.data} establishments={establishments.data} api={api} initialEstablishmentId={search.get('establishmentId')}>
        {children}
      </SessionProvider>
    </SignOutContext.Provider>
  );
}

/**
 * Sair: encerra no back, desmonta as telas (nenhuma consulta volta a buscar), limpa TODO o cache
 * (dados e sessão) e volta ao login.
 */
export function useSignOut() {
  const api = useApi();
  const begin = useContext(SignOutContext);
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    try {
      await api.auth.signOut();
    } finally {
      if (begin) flushSync(begin);
      qc.cancelQueries();
      qc.clear();
      router.replace('/login');
    }
  }, [api, begin, qc, router]);
}
