import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Device, Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockDevicesApi, resetMockDevices } from '@/lib/api/mocks/devices';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { currentRoute, router } from '../../../test/navigation';
import { DevicesScreen } from './DevicesScreen';

const device = (over: Partial<Device> = {}): Device => ({
  id: '1', establishmentId: '1', name: 'Portaria principal', isActive: true, connection: 'online', lastSyncAt: '2026-11-24T12:58:00.000Z',
  pendingPunches: 0, appVersion: '1.8.2', calibrationState: 'padrao', hasPunches: true, keyPrefix: 'gk_3f9a1', createdAt: '2026-03-10T11:00:00.000Z', ...over,
});

const talhao = device({ id: '2', name: 'Talhão 7', connection: 'offline', pendingPunches: 214, calibrationState: 'desatualizado' });

function setup(devices: ApiOverrides['devices'] = {}, role: Exclude<Role, 'super_admin'> = 'rh', route = '/rh/totens') {
  const list = vi.fn(async () => [device(), talhao]);
  const view = renderWithSession(<DevicesScreen />, { role, route, api: { devices: { list, ...devices } } });
  return { ...view, list };
}

beforeEach(() => resetMockDevices());

describe('Totens: lista', () => {
  it('mostra a tabela com status, lote pendente e calibração, sem violação de acessibilidade', async () => {
    const { container, list } = setup();
    expect(await screen.findByText('Talhão 7')).toBeInTheDocument();
    expect(screen.getByText('214 batidas')).toBeInTheDocument();
    expect(screen.getByText('Desatualizado')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ establishmentId: '1' }, expect.anything());
    expect(await axe(container)).toHaveNoViolations();
  });
  it('mostra o skeleton enquanto carrega', () => {
    setup({ list: vi.fn(() => new Promise<Device[]>(() => {})) });
    expect(screen.getByLabelText('Carregando')).toHaveAttribute('aria-busy', 'true');
  });
  it('vazio com chamada para cadastrar', async () => {
    setup({ list: vi.fn(async () => []) });
    expect(await screen.findByText('Nenhum totem neste estabelecimento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar totem' })).toBeInTheDocument();
  });
  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const list = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    setup({ list });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
  it('404 da api mostra a tela de item não encontrado', async () => {
    setup({ list: vi.fn(async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); }) });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });
  it('gestor vê sem permissão e a lista nem é consultada', async () => {
    const { list } = setup({}, 'gestor');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
  it.each(['rh', 'admin'] as const)('%s vê o botão Novo totem', async (role) => {
    setup({}, role);
    expect(await screen.findByRole('button', { name: 'Novo totem' })).toBeInTheDocument();
  });
  it('filtro de conexão vai para a URL e para a api', async () => {
    const { list } = setup();
    await screen.findByText('Talhão 7');
    await userEvent.click(screen.getByRole('tab', { name: 'Offline' }));
    expect(currentRoute()).toContain('conexao=offline');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ establishmentId: '1', connection: 'offline' }, expect.anything()));
  });
  it('clicar na linha abre o detalhe', async () => {
    setup();
    await userEvent.click(await screen.findByRole('row', { name: 'Abrir totem Talhão 7' }));
    expect(router.push).toHaveBeenCalledWith('/rh/totens/2');
  });
});

describe('Totens: cadastro e chave', () => {
  const createSetup = (create = vi.fn(async (b: { establishmentId: string; name: string }) => mockDevicesApi.create(b))) => ({ ...setup({ create }), create });

  async function fillAndSubmit(name: string) {
    await userEvent.click(await screen.findByRole('button', { name: 'Novo totem' }));
    await userEvent.type(await screen.findByLabelText(/Nome do totem/), name);
    await userEvent.click(screen.getByRole('button', { name: 'Cadastrar totem' }));
  }

  it('cria com o corpo certo e mostra a chave uma vez, exigindo confirmação', async () => {
    const { create } = createSetup();
    await fillAndSubmit('Refeitório');
    expect(create).toHaveBeenCalledWith({ establishmentId: '1', name: 'Refeitório' });
    const key = await screen.findByTestId('device-key');
    expect(key.textContent).toMatch(/^gk_[0-9a-f]{40}$/);
    const apiKey = key.textContent ?? '';
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Guardei a chave/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    await waitFor(() => expect(screen.queryByTestId('device-key')).toBeNull());
    expect(document.body.textContent).not.toContain(apiKey);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(apiKey);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(apiKey);
    expect(window.location.href).not.toContain(apiKey);
  });

  it('a chave não fica no cache de mutações do React Query', async () => {
    const { queryClient } = createSetup();
    await fillAndSubmit('Refeitório');
    const key = (await screen.findByTestId('device-key')).textContent ?? '';
    const cached = JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.data));
    expect(cached).not.toContain(key);
  });

  it('nome repetido (409) vira erro no campo', async () => {
    createSetup();
    await fillAndSubmit('talhão 7');
    expect(await screen.findByText('Já existe um totem com este nome neste estabelecimento.')).toBeInTheDocument();
    expect(screen.queryByTestId('device-key')).toBeNull();
  });
});

describe('Totens: ações', () => {
  async function openEdit(name: string) {
    await userEvent.click(await screen.findByRole('button', { name: `Editar ${name}` }));
    return screen.findByRole('region', { name: 'Ações do totem' });
  }

  it('regenerar chave pede confirmação forte e só então chama a api', async () => {
    const regenerateKey = vi.fn(async (id: string) => mockDevicesApi.regenerateKey(id));
    setup({ regenerateKey });
    const actions = await openEdit('Portaria principal');
    await userEvent.click(within(actions).getByRole('button', { name: 'Regenerar chave' }));
    expect(regenerateKey).not.toHaveBeenCalled();
    expect(await screen.findByText(/A chave atual deixa de funcionar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Regenerar chave', hidden: false }));
    await waitFor(() => expect(regenerateKey).toHaveBeenCalledWith('1'));
    expect(await screen.findByTestId('device-key')).toBeInTheDocument();
  });

  it('excluir fica desabilitado quando o totem tem batidas', async () => {
    const remove = vi.fn(async () => undefined);
    setup({ remove });
    const actions = await openEdit('Portaria principal');
    expect(within(actions).getByRole('button', { name: 'Excluir totem' })).toBeDisabled();
    expect(within(actions).getByText(/já registrou batidas/)).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();
  });

  it('excluir exige digitar o nome e mostra o 409 da api sem fechar', async () => {
    const livre = device({ id: '9', name: 'Cantina', hasPunches: false });
    const remove = vi.fn(async () => { throw new ApiError('conflict', 409, 'APARELHO_COM_BATIDAS', 'Este totem já registrou batidas e não pode ser excluído. Desative-o.'); });
    setup({ list: vi.fn(async () => [livre]), remove });
    const actions = await openEdit('Cantina');
    await userEvent.click(within(actions).getByRole('button', { name: 'Excluir totem' }));
    const confirm = await screen.findByRole('button', { name: 'Excluir totem', hidden: false });
    const buttons = screen.getAllByRole('button', { name: 'Excluir totem' });
    const dialogButton = buttons.at(-1) ?? confirm;
    expect(dialogButton).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Digite “Cantina” para confirmar/), 'Cantina');
    expect(dialogButton).toBeEnabled();
    await userEvent.click(dialogButton);
    expect(await screen.findByText(/não pode ser excluído/)).toBeInTheDocument();
    expect(remove).toHaveBeenCalledWith('9');
  });

  it('desativar chama update com isActive false depois de confirmar', async () => {
    const update = vi.fn(async (id: string, b: { isActive?: boolean }) => mockDevicesApi.update(id, b));
    setup({ update });
    const actions = await openEdit('Portaria principal');
    await userEvent.click(within(actions).getByRole('button', { name: 'Desativar totem' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('1', { isActive: false }));
  });
});
