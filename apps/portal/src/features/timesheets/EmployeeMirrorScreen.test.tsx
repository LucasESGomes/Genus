import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { RecalculateResult, Role, TimesheetDay } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockEmployeesApi } from '@/lib/api/mocks/employees';
import { mockTimesheetsApi } from '@/lib/api/mocks/timesheets';
import { renderWithSession } from '../../../test/render';
import { router } from '../../../test/navigation';
import { EmployeeMirrorScreen } from './EmployeeMirrorScreen';

const PERIOD = 'from=2026-11-01&to=2026-11-21';
const route = (id: string, extra = '') => `/rh/colaboradores/${id}?${PERIOD}${extra}`;

function setup(opts: {
  id?: string;
  role?: Exclude<Role, 'super_admin'>;
  extra?: string;
  byEmployee?: typeof mockTimesheetsApi.byEmployee;
  recalculate?: typeof mockTimesheetsApi.recalculate;
  get?: typeof mockEmployeesApi.get;
} = {}) {
  const { id = '102', role = 'rh', extra, byEmployee = mockTimesheetsApi.byEmployee, recalculate = mockTimesheetsApi.recalculate, get = mockEmployeesApi.get } = opts;
  const byEmployeeFn = vi.fn(byEmployee);
  const recalculateFn = vi.fn(recalculate);
  const getFn = vi.fn(get);
  const view = renderWithSession(<EmployeeMirrorScreen rawId={id} />, {
    role,
    route: route(id, extra),
    api: { timesheets: { byEmployee: byEmployeeFn, recalculate: recalculateFn }, employees: { get: getFn } },
  });
  return { ...view, byEmployeeFn, recalculateFn, getFn };
}

describe('Espelho do colaborador', () => {
  it('ID inválido mostra "não encontrado" e não chama a api', async () => {
    const { byEmployeeFn, getFn } = setup({ id: '../admin' });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    expect(getFn).not.toHaveBeenCalled();
    expect(byEmployeeFn).not.toHaveBeenCalled();
  });

  it('mostra o colaborador, os dias do período e a soma de exibição, sem violações de acessibilidade', async () => {
    const { container, byEmployeeFn } = setup();
    expect(await screen.findByRole('heading', { name: 'Antônio Carlos Ferreira' })).toBeInTheDocument();
    expect(await screen.findByRole('table', { name: /Espelho de/ })).toBeInTheDocument();
    expect(byEmployeeFn).toHaveBeenCalledWith('102', { from: '2026-11-01', to: '2026-11-21' }, expect.anything());
    expect(screen.getByText('Soma do período (exibição)')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('marcação tratada aparece acrescentada como "ajustada" e as originais continuam', async () => {
    setup();
    const row = await screen.findByRole('row', { name: /Ver detalhes de 18\/11\/2026/ });
    expect(within(row).getByText('ajustada')).toBeInTheDocument();
    for (const t of ['06:59', '11:02', '12:00', '15:20']) expect(within(row).getByText((c, el) => el?.tagName === 'LI' && c.startsWith(t))).toBeInTheDocument();
    // a inconsistência resolvida pelo ajuste fica marcada
    expect(within(row).getByText('Batida faltando')).toBeInTheDocument();
    expect(within(row).getByText('Resolvido')).toBeInTheDocument();
  });

  it('traduz as inconsistências abertas', async () => {
    setup();
    const row = await screen.findByRole('row', { name: /Ver detalhes de 16\/11\/2026/ });
    expect(within(row).getByText('Extra acima de 2 h')).toBeInTheDocument();
    expect(within(row).queryByText('Resolvido')).toBeNull();
  });

  it('o painel do dia mostra a origem de cada marcação e que a original não mudou', async () => {
    setup({ extra: '&dia=2026-11-18' });
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByText('Tratada')).toBeInTheDocument();
    expect(within(panel).getAllByText('Original')).toHaveLength(3);
    expect(within(panel).getByText(/A original continua registrada e não foi alterada/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Registrar ajuste deste dia/ })).toHaveAttribute('href', '/rh/ajustes?employeeId=102&date=2026-11-18&novo=1');
  });

  it('mostra o vazio com atalho quando não há dias no período', async () => {
    setup({ byEmployee: async () => [] });
    expect(await screen.findByText('Nenhum dia apurado neste período')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver apuração do dia' })).toHaveAttribute('href', '/rh/apuracao');
  });

  it('erro 5xx mostra "Tentar de novo" e busca de novo', async () => {
    const { byEmployeeFn } = setup({ byEmployee: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(byEmployeeFn.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('403 e 404 do colaborador mostram a mesma tela', async () => {
    const a = setup({ get: async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    a.unmount();
    setup({ get: async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('rh recalcula o período e vê os dias sem escala traduzidos', async () => {
    const result: RecalculateResult = { days: [], skipped: [{ date: '2026-11-03', reason: 'sem_escala' }] };
    const { recalculateFn } = setup({ recalculate: async () => result });
    await screen.findByRole('table', { name: /Espelho de/ });
    await userEvent.click(screen.getByRole('button', { name: 'Recalcular' }));
    await waitFor(() => expect(recalculateFn).toHaveBeenCalledWith('102', { from: '2026-11-01', to: '2026-11-21' }));
    const status = await screen.findByRole('status');
    expect(within(status).getByText(/03\/11: Sem escala vigente/)).toBeInTheDocument();
  });

  it('recalcular invalida o espelho: a api é consultada de novo', async () => {
    const { byEmployeeFn } = setup();
    await screen.findByRole('table', { name: /Espelho de/ });
    const before = byEmployeeFn.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Recalcular' }));
    await waitFor(() => expect(byEmployeeFn.mock.calls.length).toBeGreaterThan(before));
  });

  it('gestor e admin não veem "Recalcular"; contador não vê a tela', async () => {
    const gestor = setup({ role: 'gestor' });
    await screen.findByRole('table', { name: /Espelho de/ });
    expect(screen.queryByRole('button', { name: 'Recalcular' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Registrar ajuste do dia/ })).toBeNull();
    gestor.unmount();
    const admin = setup({ role: 'admin' });
    await screen.findByRole('table', { name: /Espelho de/ });
    expect(screen.queryByRole('button', { name: 'Recalcular' })).toBeNull();
    admin.unmount();
    const contador = setup({ role: 'contador' });
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(contador.byEmployeeFn).not.toHaveBeenCalled();
  });

  it('o PDF está desabilitado com explicação e o ajuste do dia é um link', async () => {
    setup();
    await screen.findByRole('table', { name: /Espelho de/ });
    expect(screen.getByRole('button', { name: 'Gerar espelho em PDF' })).toBeDisabled();
    expect(screen.getByText(/pdfUrl/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Registrar ajuste do dia/ })).toHaveAttribute('href', '/rh/ajustes?employeeId=102&date=2026-11-21&novo=1');
  });

  it('a soma do período é a soma simples dos minutos recebidos', async () => {
    const day = (date: string, worked: number): TimesheetDay => ({
      date, situation: 'normal', status: 'calculada', scheduleId: '1', expectedMinutes: 480, workedMinutes: worked, absenceMinutes: 0, lateMinutes: 0,
      overtime50Minutes: 0, overtime100Minutes: 0, nightMinutes: 0, breakMinutes: 60, parameterVersion: 'x', calculatedAt: `${date}T22:00:00-03:00`, punches: [], issues: [],
    });
    setup({ byEmployee: async () => [day('2026-11-02', 480), day('2026-11-03', 545)] });
    const totals = await screen.findByRole('region', { name: 'Soma do período (exibição)' });
    expect(within(totals).getByText('17:05')).toBeInTheDocument();
    expect(within(totals).getByText('16:00')).toBeInTheDocument();
  });

  it('não há diagnóstico nem CID em lugar nenhum da tela (admin e gestor)', async () => {
    for (const role of ['admin', 'gestor'] as const) {
      const v = setup({ id: '107', role });
      await screen.findByText(/Afastado de 02\/03\/2026 a 29\/06\/2026/);
      expect(v.container.textContent ?? '').not.toMatch(/\bCID\b|diagn|CRM/i);
      v.unmount();
    }
  });

  it('rotas de navegação não são acionadas sem clique', async () => {
    setup();
    await screen.findByRole('table', { name: /Espelho de/ });
    expect(router.push).not.toHaveBeenCalled();
  });
});
