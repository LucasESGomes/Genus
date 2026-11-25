import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockMeFor } from '@/lib/api/mocks';
import { mockSuperAdminApi, resetMockSuperAdmin } from '@/lib/api/mocks/super-admin';
import { currentRoute, router } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { TenantDetailScreen } from './TenantDetailScreen';
import { TenantsScreen } from './TenantsScreen';

beforeEach(() => resetMockSuperAdmin());

type SA = NonNullable<ApiOverrides['superAdmin']>;
const render = (ui: React.ReactElement, tenants: Partial<typeof mockSuperAdminApi.tenants> = {}, route = '/admin/empresas') =>
  renderWithSession(ui, { me: mockMeFor('super_admin'), route, api: { superAdmin: { tenants: { ...mockSuperAdminApi.tenants, ...tenants } } as SA } });

describe('Empresas: lista', () => {
  it('mostra as empresas com situação e contagens, sem violação de acessibilidade', async () => {
    const { container } = render(<TenantsScreen />);
    expect(await screen.findByText('Usina Boa Vista')).toBeInTheDocument();
    expect(screen.getByText('Suspensa')).toBeInTheDocument();
    expect(screen.getAllByText('Ativa')).toHaveLength(3);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('filtra por situação (URL e api) e busca com debounce', async () => {
    const list = vi.fn(mockSuperAdminApi.tenants.list);
    render(<TenantsScreen />, { list });
    await screen.findByText('Usina Boa Vista');
    await userEvent.click(screen.getByRole('tab', { name: 'Suspensas' }));
    expect(currentRoute()).toContain('status=suspensa');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ status: 'suspensa', page: 1, pageSize: 25 }, expect.anything()));
    await userEvent.click(screen.getByRole('tab', { name: 'Todas' }));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar empresa' }), 'granja');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ q: 'granja', page: 1, pageSize: 25 }, expect.anything()));
    expect(await screen.findByText('Granja São José')).toBeInTheDocument();
  });
  it('vazio e erro', async () => {
    const empty = { data: [], meta: { page: 1, pageSize: 25, total: 0 } };
    const view = render(<TenantsScreen />, { list: vi.fn(async () => empty) });
    expect(await screen.findByText('Nenhuma empresa cadastrada')).toBeInTheDocument();
    view.unmount();
    const list = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render(<TenantsScreen />, { list });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
  it('clicar na linha abre o detalhe', async () => {
    render(<TenantsScreen />);
    await userEvent.click(await screen.findByRole('row', { name: 'Abrir a empresa Granja São José' }));
    expect(router.push).toHaveBeenCalledWith('/admin/empresas/3');
  });
});

describe('Empresas: nova empresa', () => {
  async function fill(over: { cnpj?: string; email?: string } = {}) {
    await userEvent.click(await screen.findByRole('button', { name: 'Nova empresa' }));
    const dialog = await screen.findByRole('dialog');
    const type = (label: RegExp, value: string) => userEvent.type(within(dialog).getByLabelText(label), value);
    await type(/^Nome da conta/, 'Fazenda Nova Aurora');
    await type(/^Razão social/, 'Fazenda Nova Aurora Ltda');
    await type(/^CNPJ/, over.cnpj ?? '11222333000181');
    await type(/^Nome do estabelecimento/, 'Sede');
    await type(/^UF/, 'go');
    await type(/^Município/, '5218805');
    await type(/^Nome do administrador/, 'Teresa Campos');
    await type(/^E-mail do administrador/, over.email ?? 'teresa@exemplo.test');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar empresa' }));
  }

  it('mostra a senha provisória uma vez, com aviso, e ela some ao fechar (nunca no cache)', async () => {
    const create = vi.fn(mockSuperAdminApi.tenants.create);
    const { queryClient } = render(<TenantsScreen />, { create });
    await fill();
    expect(create).toHaveBeenCalledWith({
      name: 'Fazenda Nova Aurora',
      company: { legalName: 'Fazenda Nova Aurora Ltda', cnpj: '11222333000181' },
      establishment: { name: 'Sede', registrationType: 'CNPJ', registration: '11222333000181', uf: 'GO', municipalityIbge: '5218805' },
      admin: { name: 'Teresa Campos', email: 'teresa@exemplo.test' },
    });
    const pwd = (await screen.findByTestId('temporary-password')).textContent ?? '';
    expect(pwd.length).toBeGreaterThanOrEqual(12);
    expect(screen.getByText(/Esta senha aparece só agora/)).toBeInTheDocument();
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(pwd);
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Já guardei a senha/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.queryByTestId('temporary-password')).toBeNull());
    expect(document.body.textContent).not.toContain(pwd);
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(pwd);
    expect(await screen.findByText('Fazenda Nova Aurora')).toBeInTheDocument();
  });
  it('valida o CNPJ no formulário antes de chamar a api', async () => {
    const create = vi.fn(mockSuperAdminApi.tenants.create);
    render(<TenantsScreen />, { create });
    await fill({ cnpj: '11222333000182' });
    expect(await screen.findByText(/CNPJ inválido/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
  it('e-mail em uso mostra a mensagem em pt-BR e o formulário continua aberto', async () => {
    render(<TenantsScreen />);
    await fill({ email: 'lucia@exemplo.test' });
    expect(await screen.findByText('Este e-mail já está em uso na plataforma.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('temporary-password')).toBeNull();
  });
});

describe('Empresa: detalhe', () => {
  it('mostra dados, empresas, administradores e o aviso de chave ausente', async () => {
    render(<TenantDetailScreen rawId="3" />, {}, '/admin/empresas/3');
    expect(await screen.findByRole('heading', { name: 'Granja São José' })).toBeInTheDocument();
    expect(screen.getByText('Chave da empresa ausente')).toBeInTheDocument();
    expect(screen.getByText('renata@exemplo.test')).toBeInTheDocument();
    expect(await screen.findByText('77.888.999/0001-81')).toBeInTheDocument();
    expect(await screen.findByText('Uso')).toBeInTheDocument();
  });
  it('desativar um estabelecimento pede confirmação e depois oferece Reativar', async () => {
    const { container } = render(<TenantDetailScreen rawId="2" />, {}, '/admin/empresas/2');
    await userEvent.click(await screen.findByRole('button', { name: 'Desativar o estabelecimento Matriz' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Desativar estabelecimento' }));
    expect(await screen.findByRole('button', { name: 'Reativar o estabelecimento Matriz' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it('conta suspensa mostra o motivo e oferece Reativar', async () => {
    render(<TenantDetailScreen rawId="4" />, {}, '/admin/empresas/4');
    expect(await screen.findByText('Conta suspensa')).toBeInTheDocument();
    expect(screen.getByText(/Inadimplência há mais de 60 dias/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reativar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspender' })).not.toBeInTheDocument();
  });
  it('suspender exige motivo de pelo menos 3 caracteres', async () => {
    const suspend = vi.fn(mockSuperAdminApi.tenants.suspend);
    render(<TenantDetailScreen rawId="1" />, { suspend }, '/admin/empresas/1');
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender' }));
    const confirm = await screen.findByRole('button', { name: 'Suspender empresa' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motivo da suspensão/), 'ab');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Motivo da suspensão/), 'c');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(suspend).toHaveBeenCalledWith('1', 'abc'));
    expect(await screen.findByText('Conta suspensa')).toBeInTheDocument();
  });
  it('erro de conta já suspensa aparece no diálogo', async () => {
    const suspend = vi.fn(async () => { throw new ApiError('conflict', 409, 'TENANT_ALREADY_SUSPENDED', 'x'); });
    render(<TenantDetailScreen rawId="1" />, { suspend }, '/admin/empresas/1');
    await userEvent.click(await screen.findByRole('button', { name: 'Suspender' }));
    await userEvent.type(await screen.findByLabelText(/Motivo da suspensão/), 'motivo');
    await userEvent.click(screen.getByRole('button', { name: 'Suspender empresa' }));
    expect(await screen.findByText('Esta empresa já está suspensa.')).toBeInTheDocument();
  });
  it('edita o nome', async () => {
    const update = vi.fn(mockSuperAdminApi.tenants.update);
    render(<TenantDetailScreen rawId="2" />, { update }, '/admin/empresas/2');
    await userEvent.click(await screen.findByRole('button', { name: 'Editar nome' }));
    const input = await screen.findByLabelText(/Nome da conta/);
    await userEvent.clear(input);
    await userEvent.type(input, 'Usina Boa Vista Energia');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('2', { name: 'Usina Boa Vista Energia' }));
    expect(await screen.findByRole('heading', { name: 'Usina Boa Vista Energia' })).toBeInTheDocument();
  });
  it('ID inválido mostra "não encontrado" sem chamar a api', async () => {
    const get = vi.fn(mockSuperAdminApi.tenants.get);
    render(<TenantDetailScreen rawId="abc" />, { get });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
