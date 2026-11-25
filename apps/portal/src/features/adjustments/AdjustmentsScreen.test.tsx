import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { MOCK_SESSION_KEY } from '@/lib/api/mocks';
import { mockAdjustmentsApi, resetMockAdjustments } from '@/lib/api/mocks/adjustments';
import { mockTimesheetsApi } from '@/lib/api/mocks/timesheets';
import { renderWithSession } from '../../../test/render';
import { router } from '../../../test/navigation';
import { AdjustmentsScreen } from './AdjustmentsScreen';

type R = Exclude<Role, 'super_admin'>;
const asSession = (role: R) => window.sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify({ role, pending2fa: false }));

function setup(role: R = 'rh', route = '/rh/ajustes', over: { adjustments?: Partial<typeof mockAdjustmentsApi>; byEmployee?: typeof mockTimesheetsApi.byEmployee } = {}) {
  asSession(role);
  const adjustments = {
    list: vi.fn(over.adjustments?.list ?? mockAdjustmentsApi.list),
    create: vi.fn(over.adjustments?.create ?? mockAdjustmentsApi.create),
    approve: vi.fn(over.adjustments?.approve ?? mockAdjustmentsApi.approve),
    reject: vi.fn(over.adjustments?.reject ?? mockAdjustmentsApi.reject),
  };
  const byEmployee = vi.fn(over.byEmployee ?? mockTimesheetsApi.byEmployee);
  const view = renderWithSession(<AdjustmentsScreen />, { role, route, api: { adjustments, timesheets: { byEmployee } } });
  return { ...view, ...adjustments, byEmployee };
}

/** Chamadas da lista da tela (a contagem das abas usa pageSize 1). */
const listCalls = (list: ReturnType<typeof vi.fn>) => list.mock.calls.filter((c) => (c[0] as { pageSize?: number }).pageSize !== 1);

beforeEach(() => {
  window.sessionStorage.clear();
  resetMockAdjustments();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('Ajustes', () => {
  it('mostra a tabela com nomes, contagens por situação e passa no axe', async () => {
    const { container } = setup();
    expect(await screen.findByText('José Roberto Lima')).toBeInTheDocument();
    expect(screen.getByText('Maria Aparecida Souza')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Pendentes/ })).toHaveTextContent('4'));
    expect(screen.getByRole('tab', { name: /Aprovados/ })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: /Recusados/ })).toHaveTextContent('2');
    expect(screen.getByRole('tab', { name: /Todos/ })).toHaveTextContent('9');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a situação na URL filtra a lista pelo status da api', async () => {
    const { list } = setup('rh', '/rh/ajustes?status=aprovado');
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    expect(screen.queryByText('José Roberto Lima')).toBeNull();
    expect(listCalls(list)[0]?.[0]).toMatchObject({ status: 'aprovado', page: 1 });
  });

  it('clicar numa linha põe só o ID opaco na URL', async () => {
    setup();
    await userEvent.click(await screen.findByRole('row', { name: /José Roberto Lima/ }));
    expect(router.replace).toHaveBeenCalledWith('/rh/ajustes?id=1', { scroll: false });
  });

  it('vazio mostra o estado e o atalho "Novo ajuste" para o RH', async () => {
    setup('rh', '/rh/ajustes', { adjustments: { list: async () => ({ data: [], meta: { page: 1, pageSize: 25, total: 0 } }) } });
    expect(await screen.findByText('Nenhum ajuste pendente')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Novo ajuste' })).toHaveLength(2);
  });

  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const { list } = setup('rh', '/rh/ajustes', { adjustments: { list: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(listCalls(list)).toHaveLength(2));
  });

  it('403 e 404 mostram a mesma tela', async () => {
    const view = setup('rh', '/rh/ajustes', { adjustments: { list: async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); } } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    view.unmount();
    setup('rh', '/rh/ajustes', { adjustments: { list: async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); } } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('admin e colaborador não acessam a tela nem disparam a busca', async () => {
    const { list } = setup('admin');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('só o RH vê "Novo ajuste"; o gestor decide mas não lança', async () => {
    const view = setup('rh');
    expect(await screen.findByRole('button', { name: 'Novo ajuste' })).toBeInTheDocument();
    view.unmount();
    setup('gestor');
    await screen.findByText('José Roberto Lima');
    expect(screen.queryByRole('button', { name: 'Novo ajuste' })).toBeNull();
  });
});

describe('Ajustes: detalhe e decisão', () => {
  it('mostra a marcação original inalterada ao lado da proposta (acrescentada)', async () => {
    const { byEmployee } = setup('rh', '/rh/ajustes?id=1');
    const panel = await screen.findByRole('dialog');
    const original = within(panel).getByRole('heading', { name: 'Marcação original' }).parentElement as HTMLElement;
    const proposal = within(panel).getByRole('heading', { name: 'Proposta' }).parentElement as HTMLElement;
    const day = (await mockTimesheetsApi.byEmployee('104', { from: '2026-11-21', to: '2026-11-21' }))[0];
    await waitFor(() => expect(within(original).getAllByRole('listitem').length).toBeGreaterThanOrEqual(day?.punches.length ?? 1));
    expect(within(original).queryByText('15:30')).toBeNull();
    expect(within(proposal).getByText('15:30')).toBeInTheDocument();
    expect(within(panel).getAllByText(/nunca é alterada nem apagada/).length).toBeGreaterThan(0);
    expect(byEmployee).toHaveBeenCalledWith('104', { from: '2026-11-21', to: '2026-11-21' }, expect.anything());
  });

  it('gestor não aprova abono: vê "Abono: decisão do RH"', async () => {
    setup('gestor', '/rh/ajustes?id=3');
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Abono: decisão do RH')).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Aprovar' })).toBeNull();
  });

  it('gestor aprova justificativa; RH aprova abono', async () => {
    const view = setup('gestor', '/rh/ajustes?id=2');
    expect(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    view.unmount();
    setup('rh', '/rh/ajustes?id=3');
    expect(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
  });

  it('recusar exige o motivo e chama a api com ele', async () => {
    const { reject } = setup('rh', '/rh/ajustes?id=1');
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Recusar' }));
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Recusar' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo da recusa/), 'Horário não confere');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(reject).toHaveBeenCalledWith('1', { reason: 'Horário não confere' }));
  });

  it('aprovar invalida a apuração (o dia é buscado de novo) e não envia observação em branco', async () => {
    const { approve, byEmployee } = setup('rh', '/rh/ajustes?id=1');
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Aprovar' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(byEmployee).toHaveBeenCalledTimes(1));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith('1', {}));
    await waitFor(() => expect(byEmployee.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('409 "já decidido" avisa e busca a lista de novo', async () => {
    const toastError = vi.spyOn(toast, 'error');
    const { list } = setup('rh', '/rh/ajustes?id=1', {
      adjustments: { approve: async () => { throw new ApiError('conflict', 409, 'STATUS_INVALIDO', 'O ajuste já foi decidido'); } },
    });
    await userEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Aprovar' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Aprovar' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('O ajuste já foi decidido'));
    await waitFor(() => expect(listCalls(list).length).toBeGreaterThanOrEqual(2));
  });
});

describe('Ajustes: novo ajuste', () => {
  it('o atalho do espelho abre o formulário preenchido', async () => {
    setup('rh', '/rh/ajustes?employeeId=104&date=2026-11-21&novo=1');
    const panel = await screen.findByRole('dialog', { name: 'Novo ajuste' });
    expect(within(panel).getByLabelText(/^Dia/)).toHaveValue('2026-11-21');
    await waitFor(() => expect(within(panel).getByRole('combobox', { name: /Colaborador/ })).toHaveTextContent('José Roberto Lima'));
  });

  it('envia a inclusão com o horário em ISO com -03:00', async () => {
    const { create } = setup('rh', '/rh/ajustes?employeeId=104&date=2026-11-21&novo=1');
    const panel = await screen.findByRole('dialog', { name: 'Novo ajuste' });
    fireEvent.change(within(panel).getByLabelText(/Horário da marcação proposta/), { target: { value: '15:30' } });
    await userEvent.type(within(panel).getByLabelText(/^Motivo/), 'Saída esquecida');
    await userEvent.click(within(panel).getByRole('button', { name: 'Registrar ajuste' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('104', {
      date: '2026-11-21', type: 'inclusao_batida', reason: 'Saída esquecida', proposedAt: '2026-11-21T15:30:00-03:00',
    }));
  });

  it('exige o horário na inclusão de batida', async () => {
    const { create } = setup('rh', '/rh/ajustes?employeeId=104&date=2026-11-21&novo=1');
    const panel = await screen.findByRole('dialog', { name: 'Novo ajuste' });
    await userEvent.type(within(panel).getByLabelText(/^Motivo/), 'Saída esquecida');
    await userEvent.click(within(panel).getByRole('button', { name: 'Registrar ajuste' }));
    expect(await within(panel).findByText('Informe o horário da marcação.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('mock de ajustes', () => {
  it('aprovar muda o que a próxima leitura devolve e decidir de novo dá 409', async () => {
    await mockAdjustmentsApi.approve('2', {});
    const pending = await mockAdjustmentsApi.list({ status: 'pendente' });
    const approved = await mockAdjustmentsApi.list({ status: 'aprovado' });
    expect(pending.data.map((a) => a.id)).not.toContain('2');
    expect(approved.data.map((a) => a.id)).toContain('2');
    await expect(mockAdjustmentsApi.reject('2', { reason: 'tarde demais' })).rejects.toMatchObject({ status: 409, code: 'STATUS_INVALIDO' });
  });

  it('a marcação original do dia não muda depois de aprovar', async () => {
    const before = await mockTimesheetsApi.byEmployee('104', { from: '2026-11-21', to: '2026-11-21' });
    await mockAdjustmentsApi.approve('1', {});
    const after = await mockTimesheetsApi.byEmployee('104', { from: '2026-11-21', to: '2026-11-21' });
    expect(after).toEqual(before);
  });
});
