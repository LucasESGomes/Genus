import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { ApiError, unavailableError } from '@/lib/api/errors';
import { mockTimeBankApi, resetMockTimeBankPolicies } from '@/lib/api/mocks/time-bank';
import { renderWithSession } from '../../../test/render';
import { TimeBankScreen } from './TimeBankScreen';

type Api = typeof mockTimeBankApi;
function setup(opts: { role?: Exclude<Role, 'super_admin'>; route?: string; api?: Partial<Api> } = {}) {
  const { role = 'rh', route = '/rh/banco-horas', api = {} } = opts;
  const balances = vi.fn(api.balances ?? mockTimeBankApi.balances);
  const byEmployee = vi.fn(api.byEmployee ?? mockTimeBankApi.byEmployee);
  const policy = vi.fn(api.policy ?? mockTimeBankApi.policy);
  const savePolicy = vi.fn(api.savePolicy ?? mockTimeBankApi.savePolicy);
  const view = renderWithSession(<TimeBankScreen />, { role, route, api: { timeBank: { balances, byEmployee, policy, savePolicy } } });
  return { ...view, balances, byEmployee, policy, savePolicy };
}

beforeEach(() => resetMockTimeBankPolicies());

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

  it('extrato com lançamentos iguais no mesmo dia mostra todos', async () => {
    const entry = { date: '2026-11-10', type: 'credito', minutes: 30, dueDate: '2027-05-10' };
    setup({
      route: '/rh/banco-horas?colaborador=101',
      api: { byEmployee: async () => ({ balanceMinutes: 60, expiringIn30DaysMinutes: 0, entries: [entry, { ...entry }] }) },
    });
    const table = await screen.findByRole('table', { name: 'Extrato do banco de horas' });
    expect(within(table).getAllByText('Crédito')).toHaveLength(2);
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

const RULE = 'Regra do banco de horas';
const MISSING = 'Este estabelecimento não tem regra do banco de horas';
/** Estabelecimento sem regra. */
const noPolicy = async () => null;

async function choose(label: RegExp, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}
async function retype(label: RegExp, value: string) {
  const field = screen.getByLabelText(label);
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

describe('Regra do banco de horas', () => {
  it('rh vê a regra do estabelecimento e pode alterar', async () => {
    const { policy, container } = setup();
    expect(await screen.findByText('Acordo individual (6 meses)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: RULE })).toBeInTheDocument();
    expect(screen.getAllByText('2,00')).toHaveLength(2);
    expect(screen.getByText('Desde 01/01/2026, sem data de fim')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alterar regra' })).toBeEnabled();
    expect(policy).toHaveBeenCalledWith('1', expect.anything());
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('admin só consulta', async () => {
    setup({ role: 'admin' });
    expect(await screen.findByText('Acordo individual (6 meses)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /regra/i })).toBeNull();
  });

  it('gestor não vê a regra e a api da regra não é chamada', async () => {
    const { policy } = setup({ role: 'gestor' });
    await screen.findByRole('table');
    expect(screen.queryByRole('heading', { name: RULE })).toBeNull();
    expect(policy).not.toHaveBeenCalled();
  });

  it('sem regra avisa que nada é lançado; o admin não define', async () => {
    const first = setup({ api: { policy: noPolicy } });
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(screen.getByText('Sem regra, nada é lançado no banco de horas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Definir regra' })).toBeEnabled();
    first.unmount();
    setup({ role: 'admin', api: { policy: noPolicy } });
    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(screen.getByText(/A regra é cadastrada pelo RH/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Definir regra' })).toBeNull();
  });

  it('regra que ainda vai começar também avisa', async () => {
    setup({
      api: { policy: async () => ({ id: '1', establishmentId: '1', modality: 'coletivo_12m', sundayWeight: '1.50', holidayWeight: '2.00', validFrom: '2026-12-01', validTo: null }) },
    });
    expect(await screen.findByText('A regra começa em 01/12/2026')).toBeInTheDocument();
    expect(screen.getByText('1,50')).toBeInTheDocument();
  });

  it('erro na consulta da regra tem "Tentar de novo"', async () => {
    const { policy } = setup({ api: { policy: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(policy.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('cadastra a primeira regra sem valores sugeridos e manda os pesos com 2 casas', async () => {
    const { savePolicy, policy } = setup({ api: { policy: noPolicy, savePolicy: async (id, body) => ({ id: '9', establishmentId: id, validTo: null, ...body }) } });
    await userEvent.click(await screen.findByRole('button', { name: 'Definir regra' }));
    expect(screen.getByLabelText(/Peso do domingo/)).toHaveValue('');
    expect(screen.getByLabelText(/Peso do feriado/)).toHaveValue('');
    expect(screen.getByLabelText(/Início da vigência/)).toHaveValue('2026-11-21');
    await choose(/Modalidade/, 'Acordo coletivo (12 meses)');
    await retype(/Peso do domingo/, '1,5');
    await retype(/Peso do feriado/, '2');
    const before = policy.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
    await waitFor(() => expect(savePolicy).toHaveBeenCalledWith('1', { modality: 'coletivo_12m', sundayWeight: '1.50', holidayWeight: '2.00', validFrom: '2026-11-21' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Salvar regra' })).toBeNull());
    expect(policy.mock.calls.length).toBeGreaterThan(before);
  });

  it('campos inválidos não chamam a api', async () => {
    const { savePolicy } = setup({ api: { policy: noPolicy } });
    await userEvent.click(await screen.findByRole('button', { name: 'Definir regra' }));
    await retype(/Peso do domingo/, '0,5');
    await retype(/Peso do feriado/, '10');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
    expect(await screen.findByText('Escolha a modalidade.')).toBeInTheDocument();
    expect(screen.getAllByText('Informe um peso de 1,00 a 9,99.')).toHaveLength(2);
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it('alterar a regra mostra a nova vigência no painel', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Alterar regra' }));
    await retype(/Peso do domingo/, '1,75');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
    expect(await screen.findByText('1,75')).toBeInTheDocument();
    expect(screen.getByText('Desde 21/11/2026, sem data de fim')).toBeInTheDocument();
  });

  it('409 BANCO_REGRA_VIGENCIA aparece no início da vigência e o painel continua aberto', async () => {
    const { savePolicy } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Alterar regra' }));
    await retype(/Início da vigência/, '2025-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
    expect(await screen.findByText(/A data de início é anterior à da regra já registrada/)).toBeInTheDocument();
    expect(savePolicy).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Início da vigência/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Salvar regra' })).toBeEnabled();
  });

  it('422 da api vai para o campo', async () => {
    setup({
      api: { savePolicy: async () => { throw new ApiError('validation', 422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'holidayWeight', message: 'peso recusado' }]); } },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Alterar regra' }));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar regra' }));
    expect(await screen.findByText('peso recusado')).toBeInTheDocument();
  });
});

describe('mock da regra do banco', () => {
  const body = { modality: 'coletivo_12m' as const, sundayWeight: '1.50', holidayWeight: '2.00' };

  it('data posterior encerra a anterior na véspera; a mesma data atualiza; anterior dá 409', async () => {
    const created = await mockTimeBankApi.savePolicy('2', { ...body, validFrom: '2026-01-01' });
    const updated = await mockTimeBankApi.savePolicy('2', { ...body, sundayWeight: '3.00', validFrom: '2026-01-01' });
    expect(updated).toMatchObject({ id: created.id, sundayWeight: '3.00' });
    await mockTimeBankApi.savePolicy('2', { ...body, validFrom: '2026-12-01' });
    // A vigente hoje continua sendo a antiga, encerrada na véspera da próxima.
    await expect(mockTimeBankApi.policy('2')).resolves.toMatchObject({ id: created.id, validTo: '2026-11-30' });
    await expect(mockTimeBankApi.savePolicy('2', { ...body, validFrom: '2026-06-01' })).rejects.toMatchObject({ status: 409, code: 'BANCO_REGRA_VIGENCIA' });
  });

  it('estabelecimento desconhecido é 404 e peso abaixo de 1 é 422', async () => {
    await expect(mockTimeBankApi.policy('99')).rejects.toMatchObject({ status: 404 });
    await expect(mockTimeBankApi.savePolicy('2', { ...body, sundayWeight: '0.50', validFrom: '2026-01-01' })).rejects.toMatchObject({ status: 422 });
  });
});
