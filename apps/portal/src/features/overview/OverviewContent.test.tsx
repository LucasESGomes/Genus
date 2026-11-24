import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { Shell } from '@/components/shell/Shell';
import type { Me, Overview, Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockEstablishments, mockMe, mockOverview } from '@/lib/api/mocks';
import type { RhApi } from '@/lib/api/rh';
import { SessionProvider } from '@/lib/session';
import { OverviewContent } from './OverviewContent';

function setup(overview: () => Promise<Overview>, role: Role = 'rh') {
  const me: Me = { ...mockMe, role };
  const api: RhApi = { me: async () => me, establishments: async () => mockEstablishments, overview: vi.fn(overview) };
  const view = render(
    <SessionProvider me={me} establishments={mockEstablishments} api={api}>
      <Shell current="geral" title="Visão geral" subtitle="1 a 21 de novembro de 2026" period="1 a 21 nov. 2026"><OverviewContent /></Shell>
    </SessionProvider>,
  );
  return { ...view, api };
}

describe('Visão geral', () => {
  it('mostra o skeleton enquanto carrega', () => {
    setup(() => new Promise(() => {}));
    expect(screen.getByLabelText('Carregando')).toHaveAttribute('aria-busy', 'true');
  });
  it('mostra KPIs e alertas da api, sem violações de acessibilidade', async () => {
    const { container } = setup(async () => mockOverview);
    expect(await screen.findByText('Horas trabalhadas')).toBeInTheDocument();
    expect(screen.getByText('Marcações ímpares em Colheita')).toBeInTheDocument();
    expect(screen.getByText('4 abertos')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it('mostra o estado vazio', async () => {
    setup(async () => ({ kpis: [], alerts: [] }));
    expect(await screen.findByText('Ainda não há dados neste período')).toBeInTheDocument();
  });
  it('erro 5xx mostra "Tentar de novo" e busca de novo', async () => {
    const { api } = setup(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    expect(api.overview).toHaveBeenCalledTimes(2);
  });
  it('403 da api mostra sem permissão', async () => {
    setup(async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'Sem permissão'); });
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
  });
  it('colaborador vê sem permissão, sem dados do estabelecimento', async () => {
    setup(async () => mockOverview, 'colaborador');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(screen.queryByText('Horas trabalhadas')).toBeNull();
  });
  it('trocar de estabelecimento busca de novo os dados', async () => {
    const { api } = setup(async () => mockOverview);
    await screen.findByText('Horas trabalhadas');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar estabelecimento' }));
    await userEvent.click(screen.getByRole('option', { name: /Usina Boa Vista/ }));
    expect(api.overview).toHaveBeenLastCalledWith(2, expect.anything());
  });
});
