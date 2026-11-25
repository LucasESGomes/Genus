import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { ApiError, unavailableError } from '@/lib/api/errors';
import { mockTimeBankApi } from '@/lib/api/mocks/time-bank';
import { renderWithSession } from '../../../test/render';
import { TimeBankScreen } from './TimeBankScreen';

type Api = typeof mockTimeBankApi;
function setup(opts: { role?: Exclude<Role, 'super_admin'>; route?: string; api?: Partial<Api> } = {}) {
  const { role = 'rh', route = '/rh/banco-horas', api = {} } = opts;
  const balances = vi.fn(api.balances ?? mockTimeBankApi.balances);
  const byEmployee = vi.fn(api.byEmployee ?? mockTimeBankApi.byEmployee);
  const view = renderWithSession(<TimeBankScreen />, { role, route, api: { timeBank: { balances, byEmployee } } });
  return { ...view, balances, byEmployee };
}

describe('Banco de horas', () => {
  it('mostra os saldos com minutos com sinal em texto acessível e sem violações', async () => {
    const { container, balances } = setup();
    const table = await screen.findByRole('table', { name: /Saldos do banco de horas/ });
    expect(balances).toHaveBeenCalledWith({ establishmentId: '1', page: 1, pageSize: 25 }, expect.anything());
    const row = within(table).getByRole('row', { name: /Abrir extrato de João Pereira/ });
    expect(within(row).getAllByText(/hora|minuto/).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('estado vazio', async () => {
    setup({ api: { balances: async () => ({ data: [], meta: { page: 1, pageSize: 25, total: 0 } }) } });
    expect(await screen.findByText('Nenhum saldo para mostrar')).toBeInTheDocument();
  });

  it('erro com retry', async () => {
    const { balances } = setup({ api: { balances: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(balances).toHaveBeenCalledTimes(2));
  });

  it('404 mostra a tela de item não encontrado', async () => {
    setup({ api: { balances: async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); } } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('endpoint indisponível mostra "Em breve"', async () => {
    setup({ api: { balances: async () => { throw unavailableError(); } } });
    expect(await screen.findByText(/Em breve/)).toBeInTheDocument();
  });

  it('contador não acessa e a api não é chamada', async () => {
    const { balances } = setup({ role: 'contador' });
    expect(await screen.findByText(/Sem permissão/)).toBeInTheDocument();
    expect(balances).not.toHaveBeenCalled();
  });

  it('folga compensatória fica desabilitada para o rh e ausente para o gestor', async () => {
    const { unmount } = setup();
    expect(await screen.findByRole('button', { name: 'Lançar folga compensatória' })).toBeDisabled();
    unmount();
    setup({ role: 'gestor' });
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Lançar folga compensatória' })).toBeNull();
  });

  it('clicar na linha abre o extrato do colaborador', async () => {
    const { byEmployee } = setup();
    await userEvent.click(await screen.findByRole('row', { name: /Abrir extrato de João Pereira/ }));
    expect(await screen.findByRole('table', { name: 'Extrato do banco de horas' })).toBeInTheDocument();
    expect(byEmployee).toHaveBeenCalledWith('101', expect.anything());
    expect(screen.getAllByText('Crédito').length).toBeGreaterThan(0);
  });

  it('ID inválido na URL não chama o extrato', async () => {
    const { byEmployee } = setup({ route: '/rh/banco-horas?colaborador=../x' });
    await screen.findByRole('table', { name: /Saldos/ });
    expect(byEmployee).not.toHaveBeenCalled();
  });
});

describe('mock de time-bank', () => {
  it('o saldo é a soma do extrato', async () => {
    const page = await mockTimeBankApi.balances({ establishmentId: '1' });
    const row = page.data.find((r) => r.employeeId === '105');
    const ext = await mockTimeBankApi.byEmployee('105');
    expect(row?.balanceMinutes).toBe(ext.entries.reduce((s, e) => s + e.minutes, 0));
    expect(page.data.some((r) => r.balanceMinutes < 0)).toBe(true);
    expect(page.data.some((r) => r.expiringIn30DaysMinutes > 0)).toBe(true);
  });
});
