import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockMeFor } from '@/lib/api/mocks';
import { mockSuperAdminApi, resetMockSuperAdmin } from '@/lib/api/mocks/super-admin';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { formatAgo, formatUptime, HealthScreen } from './HealthScreen';

beforeEach(() => resetMockSuperAdmin());

type SA = NonNullable<ApiOverrides['superAdmin']>;
const render = (health: Partial<typeof mockSuperAdminApi.health> = {}) =>
  renderWithSession(<HealthScreen />, { me: mockMeFor('super_admin'), route: '/admin/saude', api: { superAdmin: { health: { ...mockSuperAdminApi.health, ...health } } as SA } });

describe('Saúde dos sistemas', () => {
  it('mostra o estado geral degradado, um cartão por serviço, versão e tempo no ar', async () => {
    const { container } = render();
    expect(await screen.findByText('Há sistemas degradados. Veja abaixo qual.')).toBeInTheDocument();
    const motor = screen.getByRole('heading', { name: 'Motor facial' }).closest('section')!;
    expect(within(motor).getByText('Degradado')).toBeInTheDocument();
    expect(within(motor).getByText('Latência acima do esperado (480 ms).')).toBeInTheDocument();
    expect(within(motor).getByText('Latência: 480 ms')).toBeInTheDocument();
    expect(within(motor).getByText('Galerias em cache')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8);
    expect(screen.getByText(/versão 0\.14\.0/)).toBeInTheDocument();
    expect(screen.getByText(/no ar há 10 d 1 h 30 min/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Atualizar agora busca de novo', async () => {
    const get = vi.fn(mockSuperAdminApi.health.get);
    render({ get });
    await screen.findByText('Há sistemas degradados. Veja abaixo qual.');
    expect(get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('erro sem dado: tentar de novo', async () => {
    const get = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ get });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('falha ao atualizar mantém os últimos dados e mostra aviso', async () => {
    const ok = await mockSuperAdminApi.health.get();
    let calls = 0;
    const get = vi.fn(async () => {
      if (++calls === 1) return ok;
      throw new ApiError('server', 503, 'HTTP_503', 'x');
    });
    render({ get });
    await screen.findByText('Há sistemas degradados. Veja abaixo qual.');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar agora' }));
    expect(await screen.findByText(/Não foi possível atualizar a saúde dos sistemas/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Motor facial' })).toBeInTheDocument();
  });
});

describe('formatação', () => {
  it('tempo no ar e tempo desde a verificação', () => {
    expect(formatUptime(90)).toBe('1 min');
    expect(formatUptime(3 * 3600 + 120)).toBe('3 h 2 min');
    expect(formatAgo(2)).toBe('agora há pouco');
    expect(formatAgo(42)).toBe('há 42 s');
    expect(formatAgo(300)).toBe('há 5 min');
  });
});
