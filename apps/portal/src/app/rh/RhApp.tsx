'use client';
import { ListChecks } from '@phosphor-icons/react';
import { Shell } from '@/components/shell/Shell';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { OverviewContent } from '@/features/overview/OverviewContent';
import { createRhApi } from '@/lib/api/rh';
import { SessionProvider } from '@/lib/session';
import { useResource } from '@/lib/use-resource';

const api = createRhApi();

export function RhApp() {
  const { state, retry } = useResource(async (signal) => {
    const [me, establishments] = await Promise.all([api.me(signal), api.establishments(signal)]);
    return { me, establishments };
  }, []);
  if (state.status === 'loading') return <div className="p-8"><LoadingState label="Carregando sessão…" /></div>;
  if (state.status === 'error') {
    // Sem sessão: o login do Better Auth fica em /auth. A tela de login não existe no design (pendência).
    return <div className="p-8"><ErrorState what="a sua sessão" code={state.error.code} onRetry={retry} /></div>;
  }
  return (
    <SessionProvider me={state.data.me} establishments={state.data.establishments} api={api}>
      <Shell current="geral" title="Visão geral" subtitle="1 a 21 de novembro de 2026 · America/Sao_Paulo" period="1 a 21 nov. 2026"
        primary={{ label: 'Revisar inconsistências', icon: <ListChecks size={18} aria-hidden /> }}>
        <OverviewContent />
      </Shell>
    </SessionProvider>
  );
}
