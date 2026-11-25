'use client';
/** /rh/usuarios: o admin convida e revoga acessos da própria conta. */
import { PageHeader } from '@/components/shell/PageHeader';
import { ForbiddenState } from '@/components/ui/States';
import { can } from '@/lib/auth/permissions';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { InvitesSection } from './InvitesSection';

export function UsersScreen() {
  const { me, establishment } = useSession();
  if (!can(me.role, 'nav.users')) {
    return <PageHeader title={COPY.users.title}><ForbiddenState screen={COPY.users.title} establishment={establishment.name} /></PageHeader>;
  }
  return (
    <PageHeader title={COPY.users.title} subtitle={COPY.users.subtitle}>
      <InvitesSection tenantId={null} />
    </PageHeader>
  );
}
