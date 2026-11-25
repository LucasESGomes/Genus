'use client';
/** Painel da operação Genus. A rota /admin/ativar-2fa fica FORA deste grupo: sem 2FA a sessão não passa pelo AuthGate. */
import { Suspense, type ReactNode } from 'react';
import { AdminShell } from '@/components/admin-shell/AdminShell';
import { LoadingState } from '@/components/ui/States';
import { AuthGate } from '@/lib/auth/gate';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-8"><LoadingState label="Carregando…" /></div>}>
      <AuthGate area="admin">
        <AdminShell>{children}</AdminShell>
      </AuthGate>
    </Suspense>
  );
}
