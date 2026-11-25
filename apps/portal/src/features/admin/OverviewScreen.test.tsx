import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockMeFor } from '@/lib/api/mocks';
import { mockSuperAdminApi, resetMockSuperAdmin } from '@/lib/api/mocks/super-admin';
import type { StatsOverview } from '@/lib/api/super-admin-contracts';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { OverviewScreen } from './OverviewScreen';

beforeEach(() => resetMockSuperAdmin());

function setup(superAdmin: NonNullable<ApiOverrides['superAdmin']> = {}) {
  return renderWithSession(<OverviewScreen />, { me: mockMeFor('super_admin'), route: '/admin', api: { superAdmin } });
}

describe('Visão geral', () => {
  it('mostra o skeleton enquanto carrega', () => {
    setup({ stats: { ...mockSuperAdminApi.stats, overview: vi.fn(() => new Promise<StatsOverview>(() => {})) } });
    expect(screen.getByLabelText('Carregando')).toHaveAttribute('aria-busy', 'true');
  });
  it('com dados: cards, gráfico por dia, módulos, maiores empresas e faixa de saúde', async () => {
    const { container } = setup();
    expect(await screen.findByText('Empresas ativas')).toBeInTheDocument();
    expect(screen.getByText('1 suspensa')).toBeInTheDocument();
    expect(screen.getByText('Colaboradores')).toBeInTheDocument();
    expect(screen.getByText('Taxa processada')).toBeInTheDocument();
    expect(screen.getByText('98,2%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Batidas por dia/ })).toBeInTheDocument();
    expect(screen.getByText('Uso dos módulos')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agropecuária Santa Helena' })).toHaveAttribute('href', '/admin/empresas/1');
    expect(await screen.findByRole('link', { name: 'Ver detalhes' })).toHaveAttribute('href', '/admin/saude');
    expect(await screen.findByText('Degradado')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it('trocar a janela chama a api com a nova janela', async () => {
    const overview = vi.fn(mockSuperAdminApi.stats.overview);
    setup({ stats: { ...mockSuperAdminApi.stats, overview } });
    await screen.findByText('Empresas ativas');
    await userEvent.click(screen.getByRole('button', { name: '30d' }));
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith('30d', expect.anything()));
    expect(overview).toHaveBeenCalledWith('24h', expect.anything());
  });
  it('sem empresas mostra o estado vazio', async () => {
    const base = await mockSuperAdminApi.stats.overview('24h');
    setup({ stats: { ...mockSuperAdminApi.stats, overview: vi.fn(async () => ({ ...base, tenants: { total: 0, active: 0, suspended: 0 } })) } });
    expect(await screen.findByText('Nenhuma empresa ainda')).toBeInTheDocument();
  });
  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const overview = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    setup({ stats: { ...mockSuperAdminApi.stats, overview } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(overview).toHaveBeenCalledTimes(2));
  });
  it('falha na saúde não derruba a tela', async () => {
    setup({ health: { get: vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); }) } });
    expect(await screen.findByText('Empresas ativas')).toBeInTheDocument();
    expect(await screen.findByText(/Não foi possível consultar a saúde/)).toBeInTheDocument();
  });
});
