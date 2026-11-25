import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError, toApiError } from '@/lib/api/errors';
import { mockEmployeePortalApi, resetEmployeePortalMock } from '@/lib/api/mocks/employee-portal';
import { renderWithSession } from '../../../test/render';
import { VacationsScreen } from './VacationsScreen';

beforeEach(() => resetEmployeePortalMock());

const render = (over: Partial<typeof mockEmployeePortalApi> = {}) =>
  renderWithSession(<VacationsScreen />, { role: 'colaborador', route: '/me/ferias', api: { employeePortal: over } });

async function fillAndSend(dialog: HTMLElement, start: string, end: string) {
  fireEvent.change(within(dialog).getByLabelText(/Primeiro dia/), { target: { value: start } });
  fireEvent.change(within(dialog).getByLabelText(/Último dia/), { target: { value: end } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
}

async function openSheet() {
  await userEvent.click(await screen.findByRole('button', { name: 'Pedir férias' }));
  return screen.findByRole('dialog');
}

describe('Portal do funcionário: Férias', () => {
  it('mostra os dias disponíveis, as próximas e o histórico com os rótulos de status', async () => {
    const { container } = render();
    const card = await screen.findByRole('region', { name: 'Dias disponíveis' });
    expect(card).toHaveTextContent('19');
    expect(card).toHaveTextContent('de 30');
    expect(card).toHaveTextContent('Usar até 28/02/2027');
    expect(screen.getByText('Período aquisitivo 03/2025 a 02/2026')).toBeInTheDocument();
    const next = screen.getByRole('heading', { name: 'Próximas' }).closest('section')!;
    expect(within(next).getByText('21 a 31 de dezembro de 2026')).toBeInTheDocument();
    expect(within(next).getByText('Aprovada')).toBeInTheDocument();
    const history = screen.getByRole('heading', { name: 'Histórico' }).closest('section')!;
    expect(within(history).getByText('Recusada')).toBeInTheDocument();
    expect(within(history).getByText(/limite de pessoas em férias/)).toBeInTheDocument();
    expect(within(history).getByText('Gozada')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('o botão "Pedir férias" tem alvo de pelo menos 56 px', async () => {
    render();
    expect(await screen.findByRole('button', { name: 'Pedir férias' })).toHaveClass('min-h-14');
  });

  it('mostra o vazio sem períodos aquisitivos', async () => {
    render({ vacations: vi.fn(async () => []) });
    expect(await screen.findByText('Você ainda não tem férias a pedir')).toBeInTheDocument();
  });

  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const vacations = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ vacations });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(vacations).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 mostram a mesma tela de item não encontrado', async () => {
    render({ vacations: vi.fn(async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); }) });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('o pedido envia período, datas e abono, sem employeeId, e o pedido novo aparece na lista (mutação do mock)', async () => {
    const requestVacation = vi.fn(mockEmployeePortalApi.requestVacation);
    render({ requestVacation });
    const dialog = await openSheet();
    await fillAndSend(dialog, '2027-01-11', '2027-01-20');
    await waitFor(() => expect(requestVacation).toHaveBeenCalledTimes(1));
    expect(requestVacation.mock.calls[0]?.[0]).toEqual({ accrualPeriodId: '701', startDate: '2027-01-11', endDate: '2027-01-20', cashBonusDays: 0 });
    expect(JSON.stringify(requestVacation.mock.calls)).not.toMatch(/employee/i);
    expect(await screen.findByText('Solicitada')).toBeInTheDocument();
    expect(screen.getByText('11 a 20 de janeiro de 2027')).toBeInTheDocument();
  });

  it('409 de setor desfalcado aparece em linguagem simples e o pedido continua aberto', async () => {
    render();
    const dialog = await openSheet();
    await fillAndSend(dialog, '2026-12-22', '2026-12-24');
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Muita gente do seu setor já está de férias nessas datas');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it.each([
    ['FERIAS_SALDO_INSUFICIENTE', 'Os dias pedidos passam do direito do período aquisitivo', 'Você pediu mais dias do que tem disponíveis'],
    ['FERIAS_FRACIONAMENTO_INVALIDO', 'Férias em no máximo 3 períodos', 'Férias em no máximo 3 períodos'],
    ['FERIAS_ABONO_ACIMA_LIMITE', 'O abono passa de 1/3 do direito', 'O abono passa de 1/3 do direito'],
  ])('409 %s mostra o motivo', async (code, message, shown) => {
    const requestVacation = vi.fn(async () => { throw toApiError(409, { code, error: message }); });
    render({ requestVacation });
    const dialog = await openSheet();
    await fillAndSend(dialog, '2027-02-01', '2027-02-05');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(shown);
  });

  it('abono fora de 0 a 10 não chama a api', async () => {
    const requestVacation = vi.fn(mockEmployeePortalApi.requestVacation);
    render({ requestVacation });
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText(/Dias de abono/), { target: { value: '11' } });
    await fillAndSend(dialog, '2027-02-01', '2027-02-05');
    expect(await within(dialog).findByText('Informe de 0 a 10 dias.')).toBeInTheDocument();
    expect(requestVacation).not.toHaveBeenCalled();
  });
});
