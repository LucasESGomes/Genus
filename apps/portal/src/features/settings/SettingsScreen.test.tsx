import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { ApiError, unavailableError } from '@/lib/api/errors';
import { mockAdminApi } from '@/lib/api/mocks/admin';
import { renderWithSession } from '../../../test/render';
import { SettingsScreen } from './SettingsScreen';

const setup = (role: Exclude<Role, 'super_admin'> = 'rh', route = '/rh/configuracoes', api = {}) =>
  renderWithSession(<SettingsScreen />, { role, route, api: { admin: api } });

describe('Configurações (prévia)', () => {
  it('admin e rh veem a página; usuários em leitura e "Convidar usuário" desabilitado', async () => {
    for (const role of ['admin', 'rh'] as const) {
      const { container, unmount } = setup(role);
      expect(await screen.findByText('Lúcia Martins')).toBeInTheDocument();
      expect(screen.getAllByText('Todos').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Convidar usuário' })).toBeDisabled();
      expect(screen.getByText('Prévia: as configurações ainda não são salvas')).toBeInTheDocument();
      if (role === 'rh') expect(await axe(container)).toHaveNoViolations();
      unmount();
    }
  });

  it('gestor e contador veem sem permissão e nada é buscado', () => {
    for (const role of ['gestor', 'contador'] as const) {
      const users = vi.fn(async () => []);
      const { unmount } = setup(role, '/rh/configuracoes', { users });
      expect(screen.getByText('Sem permissão para esta tela')).toBeInTheDocument();
      expect(users).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('parâmetros: "Salvar" desabilitado com a dica e tolerância acima de 60 mostra erro', async () => {
    setup('rh', '/rh/configuracoes?aba=parametros');
    const tolerance = await screen.findByLabelText(/Tolerância de marcação/);
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Portal do gestor/ })).not.toBeChecked();
    fireEvent.change(tolerance, { target: { value: '61' } });
    expect(await screen.findByText('O máximo é 60 minutos.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Férias simultâneas/), { target: { value: '0' } });
    expect(await screen.findByText('O mínimo é 1.')).toBeInTheDocument();
    expect(screen.getByText(/\[A CONFIRMAR\]/)).toBeInTheDocument();
  });

  it('feriados: lista nacionais e o municipal de Rio Verde, troca de ano busca de novo', async () => {
    const holidays = vi.fn(mockAdminApi.holidays);
    setup('admin', '/rh/configuracoes?aba=feriados', { holidays });
    expect(await screen.findByText('Tiradentes')).toBeInTheDocument();
    expect(screen.getByText('Aniversário de Rio Verde')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar feriado' })).toBeDisabled();
    expect(holidays).toHaveBeenCalledWith('1', 2026, expect.anything());
    await userEvent.click(screen.getByRole('combobox', { name: /Ano/ }));
    await userEvent.click(await screen.findByRole('option', { name: '2027' }));
    await waitFor(() => expect(holidays).toHaveBeenLastCalledWith('1', 2027, expect.anything()));
  });

  it('sem servidor cada aba mostra "Em breve"', async () => {
    const fail = async () => { throw unavailableError(); };
    for (const aba of ['usuarios', 'parametros', 'feriados']) {
      const { unmount } = setup('rh', `/rh/configuracoes?aba=${aba}`, { users: fail, companySettings: fail, holidays: fail });
      expect(await screen.findByText(/Em breve/)).toBeInTheDocument();
      unmount();
    }
  });

  it('erro mostra "Tentar de novo" e busca de novo', async () => {
    const users = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    setup('rh', '/rh/configuracoes', { users });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(users).toHaveBeenCalledTimes(2));
  });

  it('lista vazia de usuários mostra o estado vazio', async () => {
    setup('rh', '/rh/configuracoes', { users: async () => [] });
    expect(await screen.findByText('Nenhum usuário cadastrado')).toBeInTheDocument();
  });

  it('403 da api mostra o mesmo estado de "não encontrado"', async () => {
    setup('rh', '/rh/configuracoes', { users: async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); } });
    expect(await screen.findByText(/não tem acesso/i)).toBeInTheDocument();
  });

  it('o mock devolve cópias: alterar o resultado não muda a próxima leitura', async () => {
    const first = await mockAdminApi.companySettings();
    first.punchToleranceMinutes = 59;
    expect((await mockAdminApi.companySettings()).punchToleranceMinutes).toBe(10);
    expect((await mockAdminApi.users()).every((u) => u.email.endsWith('@exemplo.test'))).toBe(true);
  });
});
