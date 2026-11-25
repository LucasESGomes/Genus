import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { mockMeFor } from '@/lib/api/mocks';
import { router } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { AdminShell } from './AdminShell';

function setup(route = '/admin', api: ApiOverrides = {}) {
  return renderWithSession(<AdminShell><p>conteúdo</p></AdminShell>, { me: mockMeFor('super_admin'), route, api });
}
const nav = () => within(screen.getByRole('navigation', { name: 'Menu principal' }));

describe('AdminShell', () => {
  it('mostra os sete itens do menu, na ordem, sem seletor de estabelecimento', () => {
    setup();
    expect(nav().getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Visão geral', 'Empresas', 'Auditoria', 'Acessos e IPs', 'Reconhecimento', 'Saúde dos sistemas', 'Perfil e 2FA',
    ]);
    expect(nav().getByRole('link', { name: 'Empresas' })).toHaveAttribute('href', '/admin/empresas');
    expect(screen.queryByText(/Todos os estabelecimentos/)).not.toBeInTheDocument();
    expect(screen.getByText('conteúdo')).toBeInTheDocument();
  });
  it('marca só o item atual; /admin não acende em subrotas e subrota acende o pai', () => {
    setup('/admin/empresas/3');
    expect(nav().getByRole('link', { name: 'Empresas' })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: 'Visão geral' })).not.toHaveAttribute('aria-current');
  });
  it('/admin acende Visão geral', () => {
    setup('/admin');
    expect(nav().getByRole('link', { name: 'Visão geral' })).toHaveAttribute('aria-current', 'page');
  });
  it('Sair encerra a sessão e volta ao login', async () => {
    const signOut = vi.fn(async () => {});
    setup('/admin', { auth: { signOut } });
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
  it('é navegável pelo teclado e não tem violações de acessibilidade', async () => {
    const { container } = setup();
    await userEvent.tab();
    expect(document.activeElement).toBeInstanceOf(HTMLElement);
    nav().getAllByRole('link').forEach((a) => expect(a).not.toHaveAttribute('tabindex', '-1'));
    expect(await axe(container)).toHaveNoViolations();
  });
});
