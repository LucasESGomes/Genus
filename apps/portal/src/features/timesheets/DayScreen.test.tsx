import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { DayRowPage, DayRowQuery, Role } from '@/lib/api/contracts';
import type { TimesheetsApi } from '@/lib/api/endpoints/timesheets';
import { ApiError } from '@/lib/api/errors';
import { mockTimesheetsApi } from '@/lib/api/mocks/timesheets';
import { renderWithSession } from '../../../test/render';
import { router } from '../../../test/navigation';
import { DayScreen } from './DayScreen';

const ROUTE = '/rh/apuracao?date=2026-11-21';
const realDay = (q: DayRowQuery) => mockTimesheetsApi.day(q);

function setup(
  day: (q: DayRowQuery) => Promise<DayRowPage> = realDay,
  role: Exclude<Role, 'super_admin'> = 'rh',
  route = ROUTE,
  recalcDay: TimesheetsApi['recalculateDay'] = mockTimesheetsApi.recalculateDay,
) {
  const dayFn = vi.fn(day);
  const recalculate = vi.fn(mockTimesheetsApi.recalculate);
  const recalculateDay = vi.fn(recalcDay);
  const view = renderWithSession(<DayScreen />, { role, route, api: { timesheets: { day: dayFn, recalculate, recalculateDay } } });
  return { ...view, dayFn, recalculate, recalculateDay };
}

describe('Apuração do dia', () => {
  it('mostra o skeleton enquanto carrega', () => {
    setup(() => new Promise(() => {}));
    expect(document.querySelectorAll('tbody tr[aria-hidden]').length).toBe(6);
  });

  it('lista os colaboradores do dia, com rodapé e sem violações de acessibilidade', async () => {
    const { container, dayFn } = setup();
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    expect(dayFn).toHaveBeenCalledWith({ date: '2026-11-21', establishmentId: '1', departmentId: undefined, status: undefined, page: 1, pageSize: 25 }, expect.anything());
    expect(screen.getByText(/10 colaboradores · 4 inconsistências para revisar antes do fechamento/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('as contagens das abas vêm da api', async () => {
    setup(async (q) => ({ ...(await realDay(q)), counts: { todos: 77, inconsistente: 13, falta: 5, calculada: 59 } }));
    expect(await screen.findByRole('tab', { name: /Todos.*77/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Inconsistentes.*13/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Faltas.*5/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Calculadas.*59/ })).toBeInTheDocument();
  });

  it('trocar de aba guarda a aba na URL e pede à api o status', async () => {
    const { dayFn } = setup();
    await screen.findByText('Antônio Carlos Ferreira');
    await userEvent.click(screen.getByRole('tab', { name: /Faltas/ }));
    expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('aba=falta'), expect.anything());
    expect(await screen.findByText('Francisco das Chagas Silva')).toBeInTheDocument();
    expect(dayFn).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'falta' }), expect.anything());
    expect(screen.queryByText('Antônio Carlos Ferreira')).toBeNull();
  });

  it('o clique na linha abre o espelho com o ID opaco e o dia', async () => {
    setup();
    await userEvent.click(await screen.findByRole('row', { name: 'Abrir espelho de Antônio Carlos Ferreira' }));
    expect(router.push).toHaveBeenCalledWith('/rh/colaboradores/102?from=2026-11-21&to=2026-11-21');
  });

  it('traduz os motivos e destaca o extra só quando a api aponta extra_acima_2h', async () => {
    setup();
    const edson = await screen.findByRole('row', { name: /Edson Barbosa Nunes/ });
    expect(within(edson).getByText('Extra acima de 2 h')).toBeInTheDocument();
    expect(within(edson).getByText('03:37').parentElement).toHaveClass('text-warn');
    const jose = screen.getByRole('row', { name: /José Roberto Lima/ });
    expect(within(jose).getByText('Batidas em número ímpar')).toBeInTheDocument();
    expect(within(jose).getByText('sem saída')).toBeInTheDocument();
    const falta = screen.getByRole('row', { name: /Francisco das Chagas Silva/ });
    expect(within(falta).getByText('Falta', { selector: 'span' })).toBeInTheDocument();
  });

  it('a busca vai para a api (q com debounce), sem ir para a URL', async () => {
    const { dayFn } = setup();
    await screen.findByText('Antônio Carlos Ferreira');
    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar colaborador/ }), '00451');
    await waitFor(() => expect(dayFn).toHaveBeenLastCalledWith(expect.objectContaining({ q: '00451' }), expect.anything()));
    expect(await screen.findByText('Luciana Pereira Alves')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Antônio Carlos Ferreira')).toBeNull());
    expect(router.replace).not.toHaveBeenCalledWith(expect.stringContaining('00451'), expect.anything());
  });

  it('dia sem marcações mostra o vazio com o atalho para a escala', async () => {
    setup(realDay, 'rh', '/rh/apuracao?date=2026-11-22');
    expect(await screen.findByText('Nenhuma marcação em 22/11')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver escala do dia' })).toHaveAttribute('href', '/rh/escalas');
  });

  it('erro 5xx mostra "Tentar de novo" e busca de novo', async () => {
    const { dayFn } = setup(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(dayFn.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('403 e 404 da api mostram a mesma tela', async () => {
    const first = setup(async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
    first.unmount();
    setup(async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('"Recalcular dia" chama o endpoint do estabelecimento com o dia da tela e atualiza a lista', async () => {
    const { dayFn, recalculateDay, recalculate, container } = setup();
    await screen.findByText('Antônio Carlos Ferreira');
    const before = dayFn.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Recalcular dia' }));
    expect(recalculateDay).toHaveBeenCalledTimes(1);
    expect(recalculateDay).toHaveBeenCalledWith({ establishmentId: '1', date: '2026-11-21' });
    expect(await screen.findByText(/21\/11\/2026: 17 colaboradores recalculados\./)).toBeInTheDocument();
    expect(screen.queryByText(/de fora/)).toBeNull();
    await waitFor(() => expect(dayFn.mock.calls.length).toBeGreaterThan(before));
    expect(recalculate).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('mostra quem ficou de fora e por quê, com o nome do colaborador', async () => {
    setup(realDay, 'rh', ROUTE, async () => ({
      recalculated: 1,
      skipped: [
        { employeeId: '102', reason: 'sem_escala' },
        { employeeId: '103', reason: 'periodo_fechado' },
        { employeeId: '999', reason: 'periodo_fechado' },
      ],
    }));
    await userEvent.click(await screen.findByRole('button', { name: 'Recalcular dia' }));
    expect(await screen.findByText(/1 colaborador recalculado\./)).toBeInTheDocument();
    // O aviso curto (toast) repete a contagem; o detalhe fica no aviso da tela.
    expect(screen.getAllByText(/3 colaboradores ficaram de fora/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Sem escala vigente \(1 colaborador\): Antônio Carlos Ferreira/)).toBeInTheDocument();
    expect(await screen.findByText(/Período fechado \(2 colaboradores\): Maria Aparecida Souza, Colaborador/)).toBeInTheDocument();
  });

  it('o resultado some ao mostrar outro dia', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Recalcular dia' }));
    expect(await screen.findByText(/21\/11\/2026: 17 colaboradores recalculados/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dia anterior' }));
    await waitFor(() => expect(screen.queryByText(/21\/11\/2026: 17 colaboradores recalculados/)).toBeNull());
  });

  it('falha no recálculo avisa o erro e não mostra resultado', async () => {
    setup(realDay, 'rh', ROUTE, async () => { throw new ApiError('server', 503, 'HTTP_503', 'Não foi possível recalcular.'); });
    await userEvent.click(await screen.findByRole('button', { name: 'Recalcular dia' }));
    expect(await screen.findByText('Não foi possível recalcular.')).toBeInTheDocument();
    // O aviso da tela começa pela data (toasts de outros testes ficam no DOM e não a trazem).
    expect(screen.queryByText(/21\/11\/2026: .*recalculado/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Recalcular dia' })).toBeEnabled();
  });

  it('dia no futuro não pode ser recalculado', async () => {
    const { recalculateDay } = setup(realDay, 'rh', '/rh/apuracao?date=2026-11-30');
    const button = await screen.findByRole('button', { name: 'Recalcular dia' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(recalculateDay).not.toHaveBeenCalled();
  });

  it('gestor e admin não veem "Recalcular dia"; contador não vê a tela e a api não é chamada', async () => {
    const gestor = setup(realDay, 'gestor');
    await screen.findByText('Antônio Carlos Ferreira');
    expect(screen.queryByRole('button', { name: 'Recalcular dia' })).toBeNull();
    gestor.unmount();
    const admin = setup(realDay, 'admin');
    await screen.findByText('Antônio Carlos Ferreira');
    expect(screen.queryByRole('button', { name: 'Recalcular dia' })).toBeNull();
    admin.unmount();
    const contador = setup(realDay, 'contador');
    expect(await screen.findByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(contador.dayFn).not.toHaveBeenCalled();
  });

  it('navega entre os dias pela URL', async () => {
    setup();
    await screen.findByText('Antônio Carlos Ferreira');
    expect(screen.getByRole('button', { name: 'Próximo dia' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Dia anterior' }));
    expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('date=2026-11-20'), expect.anything());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Próximo dia' })).toBeEnabled());
  });
});

describe('mock do recálculo do dia', () => {
  it('deixa de fora quem não tinha escala e a competência fechada', async () => {
    const closed = await mockTimesheetsApi.recalculateDay({ establishmentId: '1', date: '2026-10-15' });
    expect(closed.recalculated).toBe(0);
    expect(new Set(closed.skipped.map((s) => s.reason))).toEqual(new Set(['periodo_fechado']));
    const old = await mockTimesheetsApi.recalculateDay({ establishmentId: '1', date: '2023-01-10' });
    expect(old.skipped).toContainEqual({ employeeId: '101', reason: 'sem_escala' });
  });

  it('estabelecimento desconhecido responde 404', async () => {
    await expect(mockTimesheetsApi.recalculateDay({ establishmentId: '99', date: '2026-11-21' })).rejects.toMatchObject({ status: 404 });
  });
});
