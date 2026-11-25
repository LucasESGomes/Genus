import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockMeFor } from '@/lib/api/mocks';
import { mockSuperAdminApi, resetMockSuperAdmin } from '@/lib/api/mocks/super-admin';
import { currentRoute } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { describeUserAgent } from './access-parts';
import { AccessScreen } from './AccessScreen';

beforeEach(() => resetMockSuperAdmin());

type SA = NonNullable<ApiOverrides['superAdmin']>;
const render = (access: Partial<typeof mockSuperAdminApi.access> = {}, route = '/admin/acessos') =>
  renderWithSession(<AccessScreen />, { me: mockMeFor('super_admin'), route, api: { superAdmin: { access: { ...mockSuperAdminApi.access, ...access } } as SA } });

describe('Acessos: sessões', () => {
  it('lista as sessões com navegador resumido, sem violação de acessibilidade', async () => {
    const { container } = render();
    expect(await screen.findByText('lucia@exemplo.test')).toBeInTheDocument();
    expect(screen.getAllByText('Chrome no Windows').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chrome no Windows')[0]).toHaveAttribute('title', expect.stringContaining('Mozilla/5.0'));
    expect(screen.getByRole('tab', { name: 'Sessões', selected: true })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('vazio e erro com tentar de novo', async () => {
    const empty = { data: [], meta: { page: 1, pageSize: 25, total: 0 } };
    const view = render({ sessions: vi.fn(async () => empty) });
    expect(await screen.findByText('Nenhuma sessão encontrada')).toBeInTheDocument();
    view.unmount();
    const sessions = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ sessions });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(sessions).toHaveBeenCalledTimes(2));
  });

  it('filtros: ativas e IP vão para a URL e para a api', async () => {
    const sessions = vi.fn(mockSuperAdminApi.access.sessions);
    render({ sessions });
    await screen.findByText('lucia@exemplo.test');
    await userEvent.selectOptions(screen.getByLabelText('Situação'), '1');
    expect(currentRoute()).toContain('ativas=1');
    await userEvent.type(screen.getByLabelText('IP'), '198.51.100.21');
    await waitFor(() => expect(sessions).toHaveBeenLastCalledWith(expect.objectContaining({ active: true, ip: '198.51.100.21', page: 1 }), expect.anything()));
    expect(await screen.findByText('lucia@exemplo.test')).toBeInTheDocument();
    expect(screen.queryByText('marcos@exemplo.test')).toBeNull();
  });

  it('revogar exige motivo de 3 caracteres, chama a api e avisa', async () => {
    const revokeSession = vi.fn(mockSuperAdminApi.access.revokeSession);
    render({ revokeSession });
    await userEvent.click(await screen.findByRole('button', { name: /Revogar sessão de lucia@exemplo.test/ }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Revogar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Motivo/), 'ab');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/^Motivo/), 'c');
    await userEvent.click(confirm);
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('2', 'abc'));
    expect(await screen.findByText('1 sessão revogada.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('revogar todas as sessões do usuário', async () => {
    const revokeUserSessions = vi.fn(mockSuperAdminApi.access.revokeUserSessions);
    render({ revokeUserSessions });
    await userEvent.click(await screen.findByRole('button', { name: /Revogar todas as sessões de paulo@exemplo.test/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/^Motivo/), 'conta comprometida');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(revokeUserSessions).toHaveBeenCalledWith('102', 'conta comprometida'));
  });

  it('erro ao revogar fica no diálogo, com o diálogo aberto', async () => {
    render({ revokeSession: vi.fn(async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); }) });
    await userEvent.click(await screen.findByRole('button', { name: /Revogar sessão de lucia@exemplo.test/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByLabelText(/^Motivo/), 'teste');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revogar' }));
    expect(await within(dialog).findByText('Não encontramos o registro pedido.')).toBeInTheDocument();
  });
});

describe('Acessos: tentativas de login', () => {
  it('mostra etapa, resultado e motivo; filtra por resultado', async () => {
    const loginAttempts = vi.fn(mockSuperAdminApi.access.loginAttempts);
    render({ loginAttempts }, '/admin/acessos?aba=tentativas');
    expect(await screen.findAllByText('E-mail ou senha incorretos')).not.toHaveLength(0);
    expect(screen.getByText('Código do app inválido')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Resultado'), 'sucesso');
    expect(currentRoute()).toContain('resultado=sucesso');
    await waitFor(() => expect(loginAttempts).toHaveBeenLastCalledWith(expect.objectContaining({ success: true, limit: 25 }), expect.anything()));
    await waitFor(() => expect(screen.queryByText('E-mail ou senha incorretos')).toBeNull());
  });

  it('Carregar mais usa o cursor', async () => {
    const all = (await mockSuperAdminApi.access.loginAttempts({ limit: 50 })).data;
    const loginAttempts = vi.fn(async (q: { cursor?: string }) =>
      q.cursor ? { data: all.slice(2, 3), meta: { nextCursor: null, limit: 2 } } : { data: all.slice(0, 2), meta: { nextCursor: all[1]!.id, limit: 2 } });
    render({ loginAttempts: loginAttempts as never }, '/admin/acessos?aba=tentativas');
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(loginAttempts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: all[1]!.id }), expect.anything()));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull());
  });

  it('vazio', async () => {
    render({ loginAttempts: vi.fn(async () => ({ data: [], meta: { nextCursor: null, limit: 25 } })) }, '/admin/acessos?aba=tentativas');
    expect(await screen.findByText('Nenhuma tentativa de login')).toBeInTheDocument();
  });
});

describe('Acessos: IPs sinalizados', () => {
  it('mostra motivos, a nota de que só sinaliza, e clicar no IP leva às tentativas filtradas', async () => {
    const loginAttempts = vi.fn(mockSuperAdminApi.access.loginAttempts);
    render({ loginAttempts });
    await userEvent.click(await screen.findByRole('tab', { name: 'IPs sinalizados' }));
    expect(currentRoute()).toContain('aba=ips');
    expect(await screen.findByText(/nenhum IP é bloqueado/)).toBeInTheDocument();
    expect(screen.getByText('Muitas falhas de login, Muitas contas diferentes')).toBeInTheDocument();
    expect(screen.getByText('Sinalizado')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver tentativas do IP 203.0.113.45' }));
    expect(currentRoute()).toContain('aba=tentativas');
    expect(currentRoute()).toContain('ip=203.0.113.45');
    expect(screen.getByRole('tab', { name: 'Tentativas de login', selected: true })).toBeInTheDocument();
    await waitFor(() => expect(loginAttempts).toHaveBeenLastCalledWith(expect.objectContaining({ ip: '203.0.113.45' }), expect.anything()));
    expect(screen.getByLabelText('IP')).toHaveValue('203.0.113.45');
  });

  it('janela vai para a api e vazio mostra o texto', async () => {
    const flaggedIps = vi.fn(async () => []);
    render({ flaggedIps }, '/admin/acessos?aba=ips');
    expect(await screen.findByText('Nenhum IP sinalizado')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(currentRoute()).toContain('janela=7d');
    await waitFor(() => expect(flaggedIps).toHaveBeenLastCalledWith('7d', expect.anything()));
  });
});

describe('describeUserAgent', () => {
  it('resume navegador e sistema', () => {
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0')).toBe('Firefox no Linux');
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130')).toBe('Edge no Windows');
    expect(describeUserAgent('curl/8')).toBe('Navegador desconhecido');
    expect(describeUserAgent(null)).toBe('—');
  });
});
