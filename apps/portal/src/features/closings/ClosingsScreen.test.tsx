import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Closing, Mirror, Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { clearMockClosingPendencies, mockClosingsApi, resetMockClosings } from '@/lib/api/mocks/closings';
import { renderWithSession } from '../../../test/render';
import { ClosingsScreen } from './ClosingsScreen';

beforeEach(() => resetMockClosings());

type Api = typeof mockClosingsApi;
function setup(opts: { role?: Exclude<Role, 'super_admin'>; route?: string; api?: Partial<Api> } = {}) {
  const { role = 'rh', route = '/rh/fechamento', api = {} } = opts;
  const fns = {
    list: vi.fn(api.list ?? mockClosingsApi.list),
    create: vi.fn(api.create ?? mockClosingsApi.create),
    close: vi.fn(api.close ?? mockClosingsApi.close),
    reopen: vi.fn(api.reopen ?? mockClosingsApi.reopen),
    generateMirrors: vi.fn(api.generateMirrors ?? mockClosingsApi.generateMirrors),
    mirror: vi.fn(api.mirror ?? mockClosingsApi.mirror),
  };
  const view = renderWithSession(<ClosingsScreen />, { role, route, api: { closings: fns } });
  return { ...view, ...fns };
}

describe('Fechamento', () => {
  it('lista as competências com situação e sem violações de acessibilidade', async () => {
    const { container, list } = setup();
    const table = await screen.findByRole('table', { name: /Competências de/ });
    expect(within(table).getByText('novembro de 2026')).toBeInTheDocument();
    expect(within(table).getByText('setembro de 2026')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ establishmentId: '1' }, expect.anything());
    expect(await axe(container)).toHaveNoViolations();
  });

  it('mostra o estado vazio com a ação de abrir', async () => {
    setup({ api: { list: async () => [] } });
    expect(await screen.findByText('Nenhuma competência aberta ainda')).toBeInTheDocument();
  });

  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const { list } = setup({ api: { list: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 do recurso mostram a mesma tela', async () => {
    setup({ api: { list: async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); } } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('contador só lê: sem botões de ação, mas vê os espelhos', async () => {
    setup({ role: 'contador' });
    await screen.findByRole('table', { name: /Competências de/ });
    expect(screen.queryByRole('button', { name: /Abrir competência/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Fechar / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reabrir / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Gerar espelhos/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Ver espelhos de/ }).length).toBeGreaterThan(0);
  });

  it('admin só lê', async () => {
    setup({ role: 'admin' });
    await screen.findByRole('table', { name: /Competências de/ });
    expect(screen.queryByRole('button', { name: /Abrir competência/ })).toBeNull();
  });

  it('gestor não acessa a tela e a api não é chamada', async () => {
    const { list } = setup({ role: 'gestor' });
    expect(await screen.findByText(/Sem permissão/)).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('abrir competência chama create com o mês e o estabelecimento', async () => {
    const { create } = setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir competência' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('novembro de 2026')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Próximo mês' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abrir competência' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ establishmentId: '1', referenceMonth: '2026-12' }));
    expect(await screen.findByRole('button', { name: 'Fechar dezembro de 2026' })).toBeInTheDocument();
  });

  it('competência que já existe mostra a mensagem da api (409)', async () => {
    const { create } = setup();
    await screen.findByRole('table');
    await userEvent.click(screen.getByRole('button', { name: 'Abrir competência' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Abrir competência' }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(await screen.findByText('Essa competência já existe para o estabelecimento')).toBeInTheDocument();
  });

  it('fechar com pendências mostra a mensagem da api e os dois atalhos', async () => {
    const { close } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar novembro de 2026' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Fechar competência' }));
    await waitFor(() => expect(close).toHaveBeenCalledWith('503'));
    const alert = await screen.findByText('Há inconsistências abertas ou ajustes pendentes no período');
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver inconsistências' })).toHaveAttribute('href', '/rh/apuracao?aba=inconsistente');
    expect(screen.getByRole('link', { name: 'Ver ajustes pendentes' })).toHaveAttribute('href', '/rh/ajustes?status=pendente');
    expect(screen.getByText(/3 inconsistências abertas e 2 ajustes pendentes/)).toBeInTheDocument();
  });

  it('fechar sem pendências muda a situação para fechado', async () => {
    clearMockClosingPendencies();
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar novembro de 2026' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Fechar competência' }));
    expect(await screen.findByRole('button', { name: 'Reabrir novembro de 2026' })).toBeInTheDocument();
  });

  it('reabrir exige motivo E a competência digitada, e registra o motivo', async () => {
    const { reopen } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Reabrir outubro de 2026' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/apaga a ciência dos espelhos já dados e fica registrado na auditoria/)).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: 'Reabrir competência' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Motivo da reabertura/), 'Correção de horas extras');
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Digite/), 'outubro de 2026');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(reopen).toHaveBeenCalledWith('502', { reason: 'Correção de horas extras' }));
    expect(await screen.findByText('Correção de horas extras', { exact: false })).toBeInTheDocument();
  });

  it('gerar espelhos mostra "N de M espelhos gerados"', async () => {
    const { generateMirrors } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Gerar espelhos de outubro de 2026' }));
    await waitFor(() => expect(generateMirrors).toHaveBeenCalledWith('502'));
    expect(await screen.findByText('17 de 17 espelhos gerados')).toBeInTheDocument();
  });

  it('espelho mostra totais, ciência e PDF desabilitado quando pdfUrl é nulo', async () => {
    const { mirror } = setup({ route: '/rh/fechamento?id=501&colaborador=102' });
    expect(await screen.findByText(/Ciência em/)).toBeInTheDocument();
    expect(mirror).toHaveBeenCalledWith('501', '102', expect.anything());
    expect(screen.getByText('Totais da competência')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar PDF' })).toBeDisabled();
    expect(screen.getByText(/serviço de assinatura/)).toBeInTheDocument();
  });

  it('espelho sem ciência mostra "Sem ciência"', async () => {
    const withoutAck = async (...a: Parameters<Api['mirror']>): Promise<Mirror> => ({ ...(await mockClosingsApi.mirror(...a)), acknowledgedAt: null });
    setup({ route: '/rh/fechamento?id=501&colaborador=102', api: { mirror: withoutAck } });
    expect(await screen.findByText(/Sem ciência/)).toBeInTheDocument();
  });

  it('IDs inválidos na URL nunca chamam a api do espelho', async () => {
    const { mirror } = setup({ route: '/rh/fechamento?id=501&colaborador=../admin' });
    expect(await screen.findByText('Espelhos de setembro de 2026')).toBeInTheDocument();
    expect(mirror).not.toHaveBeenCalled();
  });

  it('id de competência inválido não abre painel nem chama o espelho', async () => {
    const { mirror } = setup({ route: '/rh/fechamento?id=abc&colaborador=102' });
    await screen.findByRole('table');
    expect(screen.queryByText(/Espelhos de/)).toBeNull();
    expect(mirror).not.toHaveBeenCalled();
  });
});

describe('mock de closings', () => {
  it('reabrir muda a situação e apaga a ciência', async () => {
    const before = await mockClosingsApi.mirror('501', '102');
    expect(before.acknowledgedAt).not.toBeNull();
    const reopened: Closing = await mockClosingsApi.reopen('501', { reason: 'Teste de reabertura' });
    expect(reopened.status).toBe('reaberto');
    expect(reopened.reopenReason).toBe('Teste de reabertura');
    expect((await mockClosingsApi.mirror('501', '102')).acknowledgedAt).toBeNull();
    expect((await mockClosingsApi.list({ establishmentId: '1' })).find((c) => c.id === '501')?.status).toBe('reaberto');
  });
  it('os totais do espelho são a soma dos dias', async () => {
    const m = await mockClosingsApi.mirror('501', '103');
    expect(m.totals.workedMinutes).toBe(m.days.reduce((s, d) => s + d.workedMinutes, 0));
  });
});
