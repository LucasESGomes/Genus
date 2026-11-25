import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockEmployeePortalApi, resetEmployeePortalMock } from '@/lib/api/mocks/employee-portal';
import { renderWithSession } from '../../../test/render';
import { HomeScreen } from './HomeScreen';

beforeEach(() => resetEmployeePortalMock());

const render = (over: Partial<typeof mockEmployeePortalApi> = {}, opts: { name?: string } = {}) =>
  renderWithSession(<HomeScreen />, {
    role: 'colaborador',
    route: '/me',
    me: opts.name ? { name: opts.name } : undefined,
    api: { employeePortal: over },
  });

describe('Portal do funcionário: Início', () => {
  it('mostra o saldo, as marcações de hoje (pendente tracejado) e os avisos derivados', async () => {
    const { container } = render();
    expect(await screen.findByRole('heading', { name: 'Olá, João' })).toBeInTheDocument();
    const bank = await screen.findByRole('region', { name: 'Banco de horas' });
    expect(within(bank).getByText('+06:40')).toBeInTheDocument();
    expect(within(bank).getByText(/01:20 vencem em 30 dias/)).toBeInTheDocument();
    const punches = await screen.findByRole('list', { name: 'Marcações de hoje' });
    expect(within(punches).getByText('Entrada').nextSibling).toHaveTextContent('06:58');
    expect(within(punches).getByText('Saída').nextSibling).toHaveTextContent('pendente');
    expect(await screen.findByText('Férias aprovadas')).toBeInTheDocument();
    expect(screen.getByText('Espelho de outubro pronto para ciência')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('o número do saldo usa o limão sobre o azul da marca e o botão de atestado leva à aba Atestado (alvo de 56 px)', async () => {
    render();
    const bank = await screen.findByRole('region', { name: 'Banco de horas' });
    expect(bank).toHaveClass('bg-brand');
    expect(within(bank).getByText('+06:40').closest('.text-accent')).not.toBeNull();
    const link = screen.getByRole('link', { name: 'Enviar atestado' });
    expect(link).toHaveAttribute('href', '/me/atestado');
    expect(link).toHaveClass('min-h-14');
  });

  it('colaborador recém-admitido: 00:00 e "Ainda não há marcações", sem avisos', async () => {
    render({
      timeBank: vi.fn(async () => ({ balanceMinutes: 0, expiringIn30DaysMinutes: 0, entries: [] })),
      timesheets: vi.fn(async () => []),
      vacations: vi.fn(async () => []),
      mirrors: vi.fn(async () => []),
    });
    expect(await screen.findByText('00:00')).toBeInTheDocument();
    expect(await screen.findByText(/Ainda não há marcações/)).toBeInTheDocument();
    expect(screen.getByText(/Sem lançamentos ainda/)).toBeInTheDocument();
    expect(screen.queryByText('Avisos')).toBeNull();
  });

  it('mostra o esqueleto enquanto carrega', () => {
    render({ timeBank: vi.fn(() => new Promise<never>(() => {})), timesheets: vi.fn(() => new Promise<never>(() => {})) });
    expect(screen.getAllByLabelText('Carregando').length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Banco de horas' })).toBeNull();
  });

  it('erro de servidor mostra "Tentar de novo" e busca de novo', async () => {
    const timeBank = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ timeBank });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(timeBank).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 mostram a mesma tela de item não encontrado', async () => {
    render({ timeBank: vi.fn(async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); }) });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('o cabeçalho vem da sessão (primeiro nome) e nenhuma chamada envia employeeId', async () => {
    const timeBank = vi.fn(mockEmployeePortalApi.timeBank);
    const timesheets = vi.fn(mockEmployeePortalApi.timesheets);
    const vacations = vi.fn(mockEmployeePortalApi.vacations);
    const mirrors = vi.fn(mockEmployeePortalApi.mirrors);
    render({ timeBank, timesheets, vacations, mirrors }, { name: 'Maria Souza' });
    expect(await screen.findByRole('heading', { name: 'Olá, Maria' })).toBeInTheDocument();
    await screen.findByText('Espelho de outubro pronto para ciência');
    for (const fn of [timeBank, timesheets, vacations, mirrors]) {
      expect(fn).toHaveBeenCalled();
      expect(JSON.stringify(fn.mock.calls.map((c) => c.filter((a) => !(a instanceof AbortSignal))))).not.toMatch(/employee/i);
    }
    expect(timesheets.mock.calls[0]?.[0]).toEqual({ from: '2026-11-21', to: '2026-11-21' });
  });

  it('a navegação inferior marca a aba atual com aria-current', async () => {
    render();
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    expect(within(nav).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Espelho' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Início' })).toHaveClass('min-h-14');
  });
});
