import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { CalibrationSession, Device, Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { completeMockCalibration, mockDevicesApi, resetMockDevices } from '@/lib/api/mocks/devices';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { DeviceDetailScreen } from './DeviceDetailScreen';

const online: Device = {
  id: '1', establishmentId: '1', name: 'Portaria principal', isActive: true, connection: 'online', lastSyncAt: '2026-11-24T12:58:00.000Z',
  pendingPunches: 0, appVersion: '1.8.2', calibrationState: 'padrao', hasPunches: true, keyPrefix: 'gk_3f9a1', createdAt: '2026-03-10T11:00:00.000Z',
};
const offline: Device = { ...online, id: '2', name: 'Talhão 7', connection: 'offline', pendingPunches: 214 };

function setup(devices: ApiOverrides['devices'] = {}, opts: { id?: string; role?: Exclude<Role, 'super_admin'>; route?: string } = {}) {
  const get = vi.fn(async () => online);
  const view = renderWithSession(<DeviceDetailScreen rawId={opts.id ?? '1'} />, {
    role: opts.role ?? 'rh',
    route: opts.route ?? '/rh/totens/1',
    api: { devices: { get, ...devices } },
  });
  return { ...view, get };
}

beforeEach(() => resetMockDevices());
afterEach(() => vi.useRealTimers());

describe('Totem: detalhe', () => {
  it('mostra o resumo e passa no axe', async () => {
    const { container } = setup();
    expect(await screen.findByText('Última sincronização')).toBeInTheDocument();
    expect(screen.getByText('gk_3f9a1…')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /Abrir o totem/ });
    expect(open).toHaveAttribute('href', '/totem');
    expect(open).toHaveAttribute('target', '_blank');
    expect(open.getAttribute('href')).not.toMatch(/gk_/);
    expect(screen.getAllByText('Portaria principal').length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('ID inválido: não encontrado, sem chamar a api', async () => {
    const { get } = setup({}, { id: 'abc' });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
  it('404 e 403 mostram a mesma tela de não encontrado', async () => {
    for (const status of [404, 403] as const) {
      const { unmount } = setup({ get: vi.fn(async () => { throw new ApiError(status === 404 ? 'not_found' : 'forbidden', status, 'X', 'x'); }) });
      expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
      unmount();
    }
  });
  it('erro 5xx tem "Tentar de novo"', async () => {
    const get = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    setup({ get });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });
  it('gestor recebe sem permissão', async () => {
    const { get } = setup({}, { role: 'gestor' });
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
  it('atividade lista eventos sem dado pessoal', async () => {
    const { container } = setup({}, { route: '/rh/totens/1?aba=atividade' });
    expect(await screen.findByText('Sincronização concluída, sem lote pendente')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it('atividade vazia mostra o estado vazio', async () => {
    setup({ activity: vi.fn(async () => []) }, { route: '/rh/totens/1?aba=atividade' });
    expect(await screen.findByText('Sem atividade registrada')).toBeInTheDocument();
  });
  it('editar abre o painel com as ações', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(await screen.findByRole('region', { name: 'Ações do totem' })).toBeInTheDocument();
  });
});

const session = (over: Partial<CalibrationSession> = {}): CalibrationSession => ({
  id: '55', status: 'aguardando', startedAt: '2026-11-24T13:00:00.000Z', computedAt: null, result: null, ...over,
});

describe('Totem: calibração', () => {
  const route = '/rh/totens/1?aba=calibracao';

  it('mostra o aviso de que nenhuma batida é bloqueada e os valores atuais', async () => {
    const { container } = setup({}, { route });
    expect(await screen.findByText(/Nenhuma batida é bloqueada/)).toBeInTheDocument();
    expect(await screen.findByText('Valores do reconhecimento')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('não há captura no painel: nada de câmera nem teste de câmera', async () => {
    setup({}, { route });
    await screen.findByRole('button', { name: 'Calibrar' });
    expect(screen.queryByText(/Testar câmera/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Iniciar teste/ })).toBeNull();
  });

  it('fluxo calibrar, aguardar o totem, ver o resultado e aplicar', async () => {
    const calls: string[] = [];
    const startCalibration = vi.fn(async (id: string) => { calls.push('start'); return mockDevicesApi.startCalibration(id); });
    const applyCalibration = vi.fn(async (id: string, p: { recognitionThreshold: number; livenessThreshold: number }) => { calls.push('apply'); return mockDevicesApi.applyCalibration(id, p); });
    setup({ startCalibration, applyCalibration }, { route });
    await userEvent.click(await screen.findByRole('button', { name: 'Calibrar' }));
    expect(await screen.findByText('Aguardando o totem')).toBeInTheDocument();
    expect(screen.getByText(/abra o totem e siga os passos na tela/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Abrir o totem/ })[0]).toHaveAttribute('href', '/totem');
    // O totem simulado termina; a próxima consulta (a cada 3 s) traz a sessão calculada.
    completeMockCalibration('1');
    expect(await screen.findByText('Resultado do cálculo', {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText('86 de 100')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar a este totem' }));
    await waitFor(() => expect(applyCalibration).toHaveBeenCalledWith('1', { recognitionThreshold: 0.95, livenessThreshold: 0.9 }));
    expect(calls).toEqual(['start', 'apply']);
    expect(await screen.findByText(/Calibrado em/)).toBeInTheDocument();
  }, 30000);

  it('sessão calculada mostra atual x proposto e Descartar chama a api', async () => {
    const discardCalibration = vi.fn(async () => {});
    await mockDevicesApi.startCalibration('1');
    completeMockCalibration('1');
    setup({ discardCalibration }, { route });
    expect(await screen.findByText('Resultado do cálculo')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: /Valores atuais e propostos/ });
    expect(within(table).getByText('0,95')).toBeInTheDocument();
    expect(within(table).getByText('1,10')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(discardCalibration).toHaveBeenCalledWith('1'));
  });

  it('totem inativo não inicia a calibração', async () => {
    const startCalibration = vi.fn();
    setup({ get: vi.fn(async () => ({ ...online, isActive: false, connection: 'inativo' as const })), startCalibration }, { route });
    expect(await screen.findByText('Ative o totem para poder calibrar.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Calibrar' })).toBeNull();
    expect(startCalibration).not.toHaveBeenCalled();
  });

  it('sessão que falhou oferece descartar e tentar de novo', async () => {
    const discardCalibration = vi.fn(async () => {});
    setup({ calibrationSession: vi.fn(async () => session({ status: 'falhou' })), discardCalibration }, { route });
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar e tentar de novo' }));
    await waitFor(() => expect(discardCalibration).toHaveBeenCalledWith('1'));
  });

  it('resetar pede confirmação e depois chama a api', async () => {
    const resetCalibration = vi.fn(async (id: string) => mockDevicesApi.resetCalibration(id));
    setup({ get: vi.fn(async () => ({ ...online, id: '4', calibrationState: 'calibrado' as const })), resetCalibration }, { id: '4', route: '/rh/totens/4?aba=calibracao' });
    await userEvent.click(await screen.findByRole('button', { name: 'Resetar para o padrão' }));
    expect(resetCalibration).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Resetar para o padrão' }));
    await waitFor(() => expect(resetCalibration).toHaveBeenCalledWith('4'));
  });

  it('copiar de outro totem do mesmo estabelecimento lista só os outros e chama copyCalibration', async () => {
    const list = vi.fn(async () => [online, offline]);
    const copyCalibration = vi.fn(async (id: string, s: string) => mockDevicesApi.copyCalibration(id, s));
    setup({ list, copyCalibration }, { route });
    await waitFor(() => expect(list).toHaveBeenCalledWith({ establishmentId: '1' }, expect.anything()));
    await userEvent.click(await screen.findByRole('combobox', { name: /Totem de origem/ }));
    expect(screen.queryByRole('option', { name: /Portaria principal/ })).toBeNull();
    await userEvent.click(await screen.findByRole('option', { name: /Talhão 7/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Copiar calibração' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copiar calibração' }));
    await waitFor(() => expect(copyCalibration).toHaveBeenCalledWith('1', '2'));
  });

  it('aguardando o totem consulta a sessão a cada 3 s e para ao desmontar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calibrationSession = vi.fn(async () => session());
    const { unmount } = setup({ calibrationSession }, { route });
    await screen.findByText('Aguardando o totem');
    const before = calibrationSession.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(6100); });
    expect(calibrationSession.mock.calls.length).toBeGreaterThanOrEqual(before + 2);
    unmount();
    const after = calibrationSession.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(calibrationSession.mock.calls.length).toBe(after);
  });

  it('sem sessão não consulta em intervalo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const calibrationSession = vi.fn(async () => null);
    setup({ calibrationSession }, { route });
    await screen.findByRole('button', { name: 'Calibrar' });
    const n = calibrationSession.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(calibrationSession.mock.calls.length).toBe(n);
  });
});
