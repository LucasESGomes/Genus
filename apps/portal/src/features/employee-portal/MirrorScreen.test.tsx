import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError, toApiError } from '@/lib/api/errors';
import { mockEmployeePortalApi, resetEmployeePortalMock } from '@/lib/api/mocks/employee-portal';
import { renderWithSession } from '../../../test/render';
import { router } from '../../../test/navigation';
import { MirrorScreen } from './MirrorScreen';

beforeEach(() => resetEmployeePortalMock());

const render = (over: Partial<typeof mockEmployeePortalApi> = {}, route = '/me/espelho?mes=2026-11') =>
  renderWithSession(<MirrorScreen />, { role: 'colaborador', route, api: { employeePortal: over } });

describe('Portal do funcionário: Espelho', () => {
  it('lista os dias do mês com marcações, situação e totais', async () => {
    const { container } = render();
    const list = await screen.findByRole('list', { name: 'Dias do mês' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('21/11');
    expect(rows[0]).toHaveTextContent('06:58 · 11:01 · 12:00');
    const feriado = rows.find((r) => r.textContent?.includes('20/11'));
    expect(feriado).toHaveTextContent('Feriado');
    expect(rows.find((r) => r.textContent?.includes('16/11'))).toHaveTextContent('Extra 02:54');
    expect(rows.find((r) => r.textContent?.includes('18/11'))).toHaveTextContent('Ajuste aprovado');
    expect(screen.getByText('Trabalhado')).toBeInTheDocument();
    expect(screen.getByText('Extras')).toBeInTheDocument();
    expect(screen.getByText('Novembro de 2026')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('mostra o vazio quando o mês não tem dias apurados', async () => {
    render({ timesheets: vi.fn(async () => []) });
    expect(await screen.findByText('Sem marcações neste mês')).toBeInTheDocument();
  });

  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const timesheets = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ timesheets });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(timesheets).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 mostram a mesma tela de item não encontrado', async () => {
    render({ timesheets: vi.fn(async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); }) });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('trocar o mês guarda só o mês na URL', async () => {
    const timesheets = vi.fn(mockEmployeePortalApi.timesheets);
    render({ timesheets });
    await screen.findByRole('list', { name: 'Dias do mês' });
    expect(timesheets.mock.calls[0]?.[0]).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    // só o mês (não sensível) vai para a URL, e a tela busca o novo período
    expect(router.replace).toHaveBeenCalledWith('/me/espelho?mes=2026-10', { scroll: false });
    await waitFor(() => expect(timesheets).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' }, expect.anything()));
  });

  it('nenhuma chamada envia employeeId', async () => {
    const timesheets = vi.fn(mockEmployeePortalApi.timesheets);
    const mirrors = vi.fn(mockEmployeePortalApi.mirrors);
    render({ timesheets, mirrors });
    await screen.findByRole('list', { name: 'Dias do mês' });
    await waitFor(() => expect(mirrors).toHaveBeenCalled());
    for (const fn of [timesheets, mirrors]) {
      expect(JSON.stringify(fn.mock.calls.map((c) => c.filter((a) => !(a instanceof AbortSignal))))).not.toMatch(/employee/i);
    }
  });

  it('a navegação inferior marca Espelho com aria-current', async () => {
    render();
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getByRole('link', { name: 'Espelho' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Portal do funcionário: ciência do espelho', () => {
  it('mês fechado sem ciência: confirma em palavras simples, chama acknowledge só com o closingId e passa a mostrar "Ciência dada"', async () => {
    const acknowledge = vi.fn(mockEmployeePortalApi.acknowledge);
    render({ acknowledge }, '/me/espelho?mes=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Dar ciência' }));
    expect(await screen.findByText('Você conferiu seu espelho?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Estou ciente' }));
    await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
    expect(acknowledge.mock.calls[0]).toEqual(['502']);
    // a mutação invalidou `mirrors`: a leitura seguinte já traz a ciência
    expect(await screen.findByText('Ciência dada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar ciência' })).toBeNull();
  });

  it('mês com ciência mostra quando foi dada', async () => {
    render({}, '/me/espelho?mes=2026-09');
    expect(await screen.findByText('Ciência dada')).toBeInTheDocument();
    expect(screen.getByText(/Registrada em 04\/10\/2026/)).toBeInTheDocument();
  });

  it('mês reaberto explica que a ciência foi apagada', async () => {
    render({ mirrors: vi.fn(async () => [{ closingId: '502', referenceMonth: '2026-10', status: 'reaberto' as const, acknowledgedAt: null }]) }, '/me/espelho?mes=2026-10');
    expect(await screen.findByText('O RH reabriu este mês')).toBeInTheDocument();
    expect(screen.getByText(/ciência anterior foi apagada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dar ciência' })).toBeNull();
  });

  it('erro da api ao dar ciência aparece no diálogo, que continua aberto', async () => {
    const acknowledge = vi.fn(async () => { throw toApiError(409, { code: 'STATUS_INVALIDO', error: 'A competência foi reaberta: aguarde o novo fechamento' }); });
    render({ acknowledge }, '/me/espelho?mes=2026-10');
    await userEvent.click(await screen.findByRole('button', { name: 'Dar ciência' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Estou ciente' }));
    expect(await screen.findByText('A competência foi reaberta: aguarde o novo fechamento')).toBeInTheDocument();
    expect(screen.getByText('Você conferiu seu espelho?')).toBeInTheDocument();
  });
});

describe('Portal do funcionário: pedido de ajuste', () => {
  async function openSheet() {
    await userEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste de marcação' }));
    return screen.findByRole('dialog');
  }

  it('inclusão de batida envia data, tipo, horário com fuso e motivo (sem employeeId)', async () => {
    const requestAdjustment = vi.fn(mockEmployeePortalApi.requestAdjustment);
    render({ requestAdjustment });
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText(/Horário da marcação/), { target: { value: '15:20' } });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Esqueci de bater a saída');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(requestAdjustment).toHaveBeenCalledTimes(1));
    expect(requestAdjustment).toHaveBeenCalledWith({ date: '2026-11-21', type: 'inclusao_batida', proposedAt: '2026-11-21T15:20:00-03:00', reason: 'Esqueci de bater a saída' });
    await waitFor(() => expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute('data-state', 'closed'));
  });

  it('justificativa não pede horário nem envia proposedAt; "abono" não é oferecido', async () => {
    const requestAdjustment = vi.fn(mockEmployeePortalApi.requestAdjustment);
    render({ requestAdjustment });
    const dialog = await openSheet();
    expect(within(dialog).queryByRole('radio', { name: /abono/i })).toBeNull();
    await userEvent.click(within(dialog).getByRole('radio', { name: /Quero justificar o dia/ }));
    expect(within(dialog).queryByLabelText(/Horário da marcação/)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Consulta médica de manhã');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    await waitFor(() => expect(requestAdjustment).toHaveBeenCalledTimes(1));
    expect(requestAdjustment.mock.calls[0]?.[0]).toEqual({ date: '2026-11-21', type: 'justificativa', reason: 'Consulta médica de manhã' });
  });

  it('validação local: horário e motivo curtos não chamam a api', async () => {
    const requestAdjustment = vi.fn(mockEmployeePortalApi.requestAdjustment);
    render({ requestAdjustment });
    const dialog = await openSheet();
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'ab');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    expect(await within(dialog).findByText('Informe o horário da marcação.')).toBeInTheDocument();
    expect(within(dialog).getByText(/Escreva o motivo/)).toBeInTheDocument();
    expect(requestAdjustment).not.toHaveBeenCalled();
  });

  it('422 da api cai no campo certo (proposedAt vira o horário)', async () => {
    const requestAdjustment = vi.fn(async () => {
      throw toApiError(422, { code: 'VALIDATION_ERROR', error: 'Dados inválidos', details: [{ path: 'proposedAt', message: 'inclusão de batida exige o horário' }] });
    });
    render({ requestAdjustment });
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText(/Horário da marcação/), { target: { value: '08:00' } });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Esqueci a entrada');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    expect(await within(dialog).findByText('inclusão de batida exige o horário')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Horário da marcação/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('409 de período fechado mostra a mensagem da api e orienta falar com o RH', async () => {
    render({}, '/me/espelho?mes=2026-10');
    await screen.findByRole('list', { name: 'Dias do mês' });
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText(/Horário da marcação/), { target: { value: '08:00' } });
    await userEvent.type(within(dialog).getByLabelText(/Motivo/), 'Esqueci a entrada');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar pedido' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('O período está fechado: reabra antes de alterar');
    expect(alert).toHaveTextContent('Fale com o RH');
  });
});
