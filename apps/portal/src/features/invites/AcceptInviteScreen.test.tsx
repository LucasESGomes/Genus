import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Providers } from '@/app/providers';
import { mockInvitesApi, resetMockInvites } from '@/lib/api/mocks/invites';
import { makeTestQueryClient } from '@/lib/query/client';
import { router } from '../../../test/navigation';
import { buildApi } from '../../../test/render';
import { AcceptInviteScreen } from './AcceptInviteScreen';

const TOKEN = 'convite-de-demonstracao';
const CPF = '52998224725';

beforeEach(() => resetMockInvites());

function mount(hash: string) {
  window.history.replaceState(null, '', `/convite${hash}`);
  const preview = vi.fn(mockInvitesApi.preview);
  const accept = vi.fn(mockInvitesApi.accept);
  const queryClient = makeTestQueryClient();
  const view = render(<Providers api={buildApi({ invites: { preview, accept } })} queryClient={queryClient}><AcceptInviteScreen /></Providers>);
  return { ...view, preview, accept, queryClient };
}

async function fill(cpf: string) {
  await userEvent.type(await screen.findByLabelText(/^Seu CPF/), cpf);
  await userEvent.type(screen.getByLabelText(/^Senha/), 'senha-de-teste-123');
  await userEvent.type(screen.getByLabelText(/^Repita a senha/), 'senha-de-teste-123');
  await userEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
}

describe('/convite', () => {
  it('lê o token do fragmento, tira da barra e mostra o convite', async () => {
    const { preview, container } = mount(`#${TOKEN}`);
    expect(await screen.findByText('Agropecuária Santa Helena')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(TOKEN);
    await waitFor(() => expect(window.location.hash).toBe(''));
    expect(await axe(container)).toHaveNoViolations();
  });

  it('CPF errado fica no campo; o certo cria o acesso e leva ao login, sem CPF na URL nem no cache', async () => {
    const { accept, queryClient } = mount(`#${TOKEN}`);
    await fill('11144477735');
    expect(await screen.findByText(/O CPF não confere/)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText(/^Seu CPF/));
    await userEvent.type(screen.getByLabelText(/^Seu CPF/), CPF);
    await userEvent.click(screen.getByRole('button', { name: 'Criar acesso' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(accept).toHaveBeenLastCalledWith({ token: TOKEN, cpf: CPF, password: 'senha-de-teste-123' });
    expect(window.location.href).not.toContain(CPF);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('token que não vale mostra "Convite inválido"', async () => {
    mount('#outro-token');
    expect(await screen.findByRole('heading', { name: 'Convite inválido' })).toBeInTheDocument();
  });

  it('sem fragmento não chama a api', async () => {
    const { preview } = mount('');
    expect(await screen.findByRole('heading', { name: 'Link incompleto' })).toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });
});
