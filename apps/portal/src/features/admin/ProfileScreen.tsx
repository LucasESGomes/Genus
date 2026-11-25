'use client';
/** Perfil e 2FA (/admin/perfil): quem está logado, aviso sobre a verificação em duas etapas e saída. */
import { SignOut } from '@phosphor-icons/react';
import { useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useSignOut } from '@/lib/auth/gate';
import { ROLE_LABEL } from '@/lib/labels';
import { useSession } from '@/lib/session';

export function ProfileScreen() {
  const { me } = useSession();
  const signOut = useSignOut();
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    try {
      await signOut();
    } finally {
      setLeaving(false);
    }
  };
  return (
    <PageHeader title="Perfil e 2FA" subtitle="Sua conta no painel da operação.">
      <Card as="section" className="flex flex-col gap-4 p-5">
        <h2 className="m-0 text-base font-bold">Sua conta</h2>
        <KeyValueList
          items={[
            { label: 'Nome', value: me.name },
            { label: 'E-mail', value: me.email },
            { label: 'Papel', value: ROLE_LABEL[me.role] },
            { label: 'Verificação em duas etapas', value: <StatusBadge label={me.mfaEnabled ? '2FA ativo' : '2FA inativo'} tone={me.mfaEnabled ? 'good' : 'danger'} /> },
          ]}
        />
        <div>
          <Button variant="secondary" loading={leaving} icon={<SignOut size={18} aria-hidden />} onClick={() => void leave()}>Sair</Button>
        </div>
      </Card>
      <Card as="section" className="flex flex-col gap-2 p-5">
        <h2 className="m-0 text-base font-bold">Verificação em duas etapas</h2>
        <p className="m-0 text-sm text-ink-2">A verificação em duas etapas é obrigatória para o super admin: sem ela, a sessão só serve para ativá-la.</p>
        <p className="m-0 text-sm text-ink-2">Se você perder o app autenticador, só os códigos de recuperação entregues na ativação permitem entrar de novo. Guarde-os em local seguro.</p>
      </Card>
      <Card as="section" className="flex flex-col gap-2 p-5">
        <h2 className="m-0 text-base font-bold">Senha</h2>
        <p className="m-0 text-sm text-ink-2">Troca de senha: pelo SUPER_ADMIN_PASSWORD_HASH no .env da api.</p>
      </Card>
    </PageHeader>
  );
}
