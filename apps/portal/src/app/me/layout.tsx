'use client';
/** Portal do colaborador (mobile first, 390 px). A navegação inferior fica no layout do lote D. */
import { Suspense, type ReactNode } from 'react';
import { LoadingState } from '@/components/ui/States';
import { AuthGate } from '@/lib/auth/gate';

export default function MeLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-6"><LoadingState label="Carregando…" /></div>}>
      <AuthGate area="me">
        <div className="mx-auto min-h-screen w-full max-w-[480px] bg-white">{children}</div>
      </AuthGate>
    </Suspense>
  );
}
