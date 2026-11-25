'use client';
import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/shell/Shell';
import { LoadingState } from '@/components/ui/States';
import { AuthGate } from '@/lib/auth/gate';

export default function RhLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState label="Carregando…" /></div>}>
      <AuthGate area="rh">
        <AppShell>{children}</AppShell>
      </AuthGate>
    </Suspense>
  );
}
