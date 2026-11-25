import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { mockMeFor } from '@/lib/api/mocks';
import { router } from '../../../test/navigation';
import { renderWithSession } from '../../../test/render';
import { ProfileScreen } from './ProfileScreen';

const me = { ...mockMeFor('super_admin'), name: 'Operação Genus', email: 'superadmin@exemplo.test', mfaEnabled: true };

describe('Perfil e 2FA', () => {
  it('mostra o usuário, o papel, o 2FA e os avisos, sem violação de acessibilidade', async () => {
    const { container } = renderWithSession(<ProfileScreen />, { me, route: '/admin/perfil' });
    expect(screen.getByText('Operação Genus')).toBeInTheDocument();
    expect(screen.getByText('superadmin@exemplo.test')).toBeInTheDocument();
    expect(screen.getByText('Super admin')).toBeInTheDocument();
    expect(screen.getByText('2FA ativo')).toBeInTheDocument();
    expect(screen.getByText(/obrigatória para o super admin/)).toBeInTheDocument();
    expect(screen.getByText(/códigos de recuperação/)).toBeInTheDocument();
    expect(screen.getByText('Troca de senha: pelo SUPER_ADMIN_PASSWORD_HASH no .env da api.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Sair encerra a sessão e volta ao login', async () => {
    const signOut = vi.fn(async () => undefined);
    renderWithSession(<ProfileScreen />, { me, route: '/admin/perfil', api: { auth: { signOut } } });
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});
