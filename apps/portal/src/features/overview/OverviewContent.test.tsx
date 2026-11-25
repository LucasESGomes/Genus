import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { AppShell } from '@/components/shell/Shell';
import type { Overview, Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockOverview } from '@/lib/api/mocks';
import { currentRoute, router } from '../../../test/navigation';
import { renderWithSession } from '../../../test/render';
import { OverviewContent } from './OverviewContent';

function setup(overview: () => Promise<Overview>, role: Exclude<Role, 'super_admin'> = 'rh') {
  const get = vi.fn(overview);
  const view = renderWithSession(<AppShell><OverviewContent /></AppShell>, { role, api: { overview: { get } } });
  return { ...view, get };
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
    const { get } = setup(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
  it('403 da api mostra sem permissão', async () => {
    setup(async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'Sem permissão'); });
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
  });
  it('contador não vê a visão geral nem dispara a busca', async () => {
    const { get } = setup(async () => mockOverview, 'contador');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(screen.queryByText('Horas trabalhadas')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
  it('trocar de estabelecimento busca de novo com o novo ID opaco', async () => {
    const { get } = setup(async () => mockOverview);
    await screen.findByText('Horas trabalhadas');
    await userEvent.click(screen.getByRole('button', { name: /Trocar/ }));
    await userEvent.click(screen.getByRole('option', { name: /Usina Boa Vista/ }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('2', expect.anything()));
  });

  it('a ação primária leva à apuração filtrada por inconsistência', async () => {
    setup(async () => mockOverview);
    await userEvent.click(await screen.findByRole('button', { name: 'Revisar inconsistências' }));
    expect(router.push).toHaveBeenCalledWith('/rh/apuracao?aba=inconsistente');
  });
  it('cada alerta navega pelo seu target', async () => {
    setup(async () => mockOverview);
    await userEvent.click(await screen.findByRole('button', { name: /Revisar marcações/ }));
    expect(router.push).toHaveBeenLastCalledWith('/rh/apuracao?aba=inconsistente');
    await userEvent.click(screen.getByRole('button', { name: /Revisar escalas/ }));
    expect(router.push).toHaveBeenLastCalledWith('/rh/escalas?aviso=carga_semanal_acima_limite');
  });
  it('trocar o período grava from/to na URL e busca de novo', async () => {
    const { get } = setup(async () => mockOverview);
    await screen.findByText('Horas trabalhadas');
    expect(get).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: /^Período:/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mês anterior' }));
    await waitFor(() => expect(currentRoute()).toContain('from=2026-10-01'));
    expect(currentRoute()).toContain('to=2026-10-31');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
  it('o gráfico de horas extras aparece como indisponível, sem valores calculados', async () => {
    setup(async () => mockOverview);
    expect(await screen.findByText('Gráfico indisponível: aguardando o back')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Horas extras por dia' })).toBeInTheDocument();
  });
  it('mostra o subtítulo com o período real e o fuso', async () => {
    setup(async () => mockOverview);
    expect(await screen.findByText(/America\/Sao_Paulo/)).toBeInTheDocument();
  });
  it('sem servidor (unavailable) mostra "Em breve"', async () => {
    setup(async () => { throw new ApiError('unavailable', 0, 'UNAVAILABLE', 'x'); });
    expect(await screen.findByText(/Em breve/)).toBeInTheDocument();
  });
});
