import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockEstablishments } from '@/lib/api/mocks';
import { makeTestQueryClient } from '@/lib/query/client';
import { fixedClock } from '@/lib/clock';
import { Providers } from '@/app/providers';
import { router, setRoute } from '../../../test/navigation';
import { buildApi, renderWithSession, TEST_NOW, type ApiOverrides } from '../../../test/render';
import { useHeaderPeriod } from './useHeaderPeriod';
import { AppShell, SIDEBAR_PREF } from './Shell';

const page = (total: number) => ({ data: [], meta: { page: 1, pageSize: 1, total } });

function setup(role: Exclude<Role, 'super_admin'> = 'rh', api: ApiOverrides = {}, route = '/rh') {
  return renderWithSession(<AppShell><p>conteúdo</p></AppShell>, { role, route, api });
}

const nav = () => within(screen.getByRole('navigation', { name: 'Menu principal' }));

describe('AppShell: menu por papel', () => {
  it('contador vê só Colaboradores, Fechamento e Relatórios', () => {
    setup('contador');
    const links = nav().getAllByRole('link').map((a) => a.textContent);
    expect(links).toEqual(['Colaboradores', 'Fechamento', 'Relatórios']);
  });
  it('gestor não vê Fechamento, Totens nem Configurações', () => {
    setup('gestor');
    expect(nav().queryByRole('link', { name: /Fechamento/ })).not.toBeInTheDocument();
    expect(nav().queryByRole('link', { name: /Totens/ })).not.toBeInTheDocument();
    expect(nav().getByRole('link', { name: /Ajustes/ })).toBeInTheDocument();
  });
  it('marca o item atual com aria-current', () => {
    setup('rh', {}, '/rh/atestados');
    expect(nav().getByRole('link', { name: /Atestados/ })).toHaveAttribute('aria-current', 'page');
  });
  it('sem violações de acessibilidade', async () => {
    const { container } = setup('rh');
    expect(await axe(container)).toHaveNoViolations();
  });
  it('Sair chama signOut e volta ao login', async () => {
    const signOut = vi.fn(async () => {});
    setup('rh', { auth: { signOut } });
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});

describe('AppShell: pontos de pendência', () => {
  it('mostra o ponto com a contagem para leitores de tela', async () => {
    const certs = vi.fn(async () => page(9));
    const adj = vi.fn(async () => page(2));
    setup('rh', { certificates: { list: certs }, adjustments: { list: adj } });
    expect(await nav().findByRole('link', { name: 'Atestados, 9 pendentes' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Ajustes, 2 pendentes' })).toBeInTheDocument();
    expect(certs).toHaveBeenCalledWith({ status: 'pendente', pageSize: 1 }, expect.anything());
  });
  it('o ponto é limão sólido, sem borda nem anel', async () => {
    setup('rh', { certificates: { list: vi.fn(async () => page(3)) }, adjustments: { list: vi.fn(async () => page(0)) } });
    const link = await nav().findByRole('link', { name: 'Atestados, 3 pendentes' });
    const dots = Array.from(link.querySelectorAll('span.rounded-full.bg-accent'));
    expect(dots.length).toBeGreaterThan(0);
    for (const d of dots) expect(d.className).not.toMatch(/ring|border|outline|shadow/);
  });
  it('singular com 1 pendente', async () => {
    setup('rh', { certificates: { list: vi.fn(async () => page(1)) }, adjustments: { list: vi.fn(async () => page(0)) } });
    expect(await nav().findByRole('link', { name: 'Atestados, 1 pendente' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Ajustes' })).toBeInTheDocument();
  });
  it('erro ou "Em breve" não mostra ponto nem quebra o menu', async () => {
    const unavailable = vi.fn(async () => { throw new ApiError('unavailable', 0, 'EM_BREVE', 'x'); });
    const broken = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    setup('rh', { certificates: { list: unavailable }, adjustments: { list: broken } });
    await waitFor(() => expect(unavailable).toHaveBeenCalled());
    await waitFor(() => expect(broken).toHaveBeenCalled());
    expect(nav().getByRole('link', { name: 'Atestados' })).toBeInTheDocument();
    expect(nav().getByRole('link', { name: 'Ajustes' })).toBeInTheDocument();
  });
  it('não consulta o que o papel não vê no menu', () => {
    const certs = vi.fn(async () => page(5));
    setup('contador', { certificates: { list: certs } });
    expect(certs).not.toHaveBeenCalled();
  });
});

describe('AppShell: estabelecimento', () => {
  it('RH escolhe entre todos e a troca vale', async () => {
    setup('rh');
    await userEvent.click(screen.getByRole('button', { name: /Estabelecimento: Fazenda Santa Helena/ }));
    const list = await screen.findByRole('listbox', { name: 'Estabelecimentos' });
    expect(within(list).getAllByRole('option')).toHaveLength(mockEstablishments.length);
    await userEvent.click(within(list).getByRole('option', { name: /Usina Boa Vista/ }));
    expect(await screen.findByRole('button', { name: /Estabelecimento: Usina Boa Vista/ })).toBeInTheDocument();
  });
  it('gestor com escopo ["1"] só enxerga o próprio estabelecimento', () => {
    setup('gestor');
    const trigger = screen.getByRole('button', { name: 'Estabelecimento: Fazenda Santa Helena' });
    expect(trigger).toBeDisabled();
    expect(screen.queryByText(/Usina Boa Vista/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Granja São José/)).not.toBeInTheDocument();
  });
  it('lista só o escopo mesmo que a conta tenha mais', async () => {
    renderWithSession(<AppShell><p>x</p></AppShell>, { role: 'gestor', me: { establishmentScope: ['1', '3'] } });
    await userEvent.click(screen.getByRole('button', { name: /Estabelecimento/ }));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options.join('|')).toContain('Fazenda Santa Helena');
    expect(options.join('|')).toContain('Granja São José');
    expect(options.join('|')).not.toContain('Usina Boa Vista');
  });
  it('setas movem o foco, Esc fecha e devolve o foco ao botão', async () => {
    setup('rh');
    const trigger = screen.getByRole('button', { name: /Estabelecimento: Fazenda Santa Helena/ });
    await userEvent.click(trigger);
    const list = await screen.findByRole('listbox');
    const options = within(list).getAllByRole('option');
    await waitFor(() => expect(options[0]).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(options[1]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(options[2]).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(options[0]).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe('AppShell: recolher menu', () => {
  it('recolhe, grava genus.ui.sidebar e expande de novo', async () => {
    setup('rh');
    await userEvent.click(screen.getByRole('button', { name: 'Recolher menu' }));
    expect(window.localStorage.getItem(SIDEBAR_PREF)).toBe('collapsed');
    expect(SIDEBAR_PREF).toBe('genus.ui.sidebar');
    await userEvent.click(screen.getByRole('button', { name: 'Expandir menu' }));
    expect(window.localStorage.getItem(SIDEBAR_PREF)).toBe('expanded');
  });
  it('lê a preferência guardada', async () => {
    window.localStorage.setItem(SIDEBAR_PREF, 'collapsed');
    setup('rh');
    expect(await screen.findByRole('button', { name: 'Expandir menu' })).toBeInTheDocument();
  });
});

describe('AppShell: celular', () => {
  it('o botão de menu abre a gaveta com a navegação e fecha com Esc e com o botão', async () => {
    setup('rh');
    const open = screen.getByRole('button', { name: 'Abrir menu' });
    await userEvent.click(open);
    const dialog = await screen.findByRole('dialog', { name: 'Genus' });
    expect(within(dialog).getByRole('navigation', { name: 'Menu' })).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /Atestados/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(open);
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar menu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('alvos da gaveta têm pelo menos 44 px', async () => {
    setup('rh');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /Atestados/ }).className).toContain('h-11');
    expect(screen.getByRole('button', { name: 'Abrir menu', hidden: true }).className).toContain('h-11');
  });
});

describe('useHeaderPeriod', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <Providers api={buildApi()} clock={fixedClock(TEST_NOW)} queryClient={makeTestQueryClient()}>{children}</Providers>
  );

  it('padrão: dia 1 do mês até hoje (pelo Clock)', () => {
    setRoute('/rh/apuracao');
    const { result } = renderHook(() => useHeaderPeriod(), { wrapper });
    expect(result.current.period).toEqual({ from: '2026-11-01', to: '2026-11-21' });
  });
  it('lê from/to da URL', () => {
    setRoute('/rh/apuracao?from=2026-10-01&to=2026-10-31');
    const { result } = renderHook(() => useHeaderPeriod(), { wrapper });
    expect(result.current.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
  it('valor inválido ou invertido volta ao padrão', () => {
    setRoute('/rh/apuracao?from=2026-12-01&to=2026-11-01');
    const { result } = renderHook(() => useHeaderPeriod(), { wrapper });
    expect(result.current.period).toEqual({ from: '2026-11-01', to: '2026-11-21' });
  });
  it('setPeriod grava from e to na URL', () => {
    setRoute('/rh/apuracao');
    const { result } = renderHook(() => useHeaderPeriod(), { wrapper });
    act(() => result.current.setPeriod({ from: '2026-09-01', to: '2026-09-30' }));
    expect(router.replace).toHaveBeenCalledWith('/rh/apuracao?from=2026-09-01&to=2026-09-30', { scroll: false });
  });
});
