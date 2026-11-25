import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Role } from '@/lib/api/contracts';
import { renderWithSession } from '../../../test/render';
import { ReportsScreen } from './ReportsScreen';

const setup = (role: Exclude<Role, 'super_admin'> = 'rh') => renderWithSession(<ReportsScreen />, { role });

describe('Relatórios (prévia)', () => {
  it('lista os 5 tipos e avisa que é uma prévia', () => {
    setup();
    for (const name of ['Horas extras', 'Faltas', 'Banco de horas', 'Férias', 'Afastamentos']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
    expect(screen.getByText('Prévia: relatórios ainda não são gerados')).toBeInTheDocument();
  });

  it('escolher um tipo abre o formulário e "Gerar relatório" fica desabilitado, com a dica', async () => {
    const { container } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Horas extras/ }));
    const generate = await screen.findByRole('button', { name: 'Gerar relatório' });
    expect(generate).toBeDisabled();
    await userEvent.hover(generate.parentElement as HTMLElement);
    expect((await screen.findAllByText('Aguardando back: geração de relatórios')).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('data final antes da inicial mostra erro no campo', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Faltas/ }));
    const to = await screen.findByLabelText(/Até/);
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect(await screen.findByText('A data final vem antes da inicial.')).toBeInTheDocument();
    expect(to).toHaveAttribute('aria-invalid', 'true');
  });

  it('período acima de 366 dias mostra erro', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Faltas/ }));
    fireEvent.change(await screen.findByLabelText(/De/, { selector: 'input' }), { target: { value: '2025-01-01' } });
    fireEvent.change(screen.getByLabelText(/Até/), { target: { value: '2026-11-21' } });
    expect(await screen.findByText(/no máximo 366 dias/)).toBeInTheDocument();
  });

  it('o setor vem de api.org.departments do estabelecimento da sessão', async () => {
    const departments = vi.fn(async () => [{ id: '10', establishmentId: '1', name: 'Colheita' }]);
    renderWithSession(<ReportsScreen />, { api: { org: { departments } }, establishments: undefined });
    await userEvent.click(screen.getByRole('button', { name: /Férias/ }));
    await waitFor(() => expect(departments).toHaveBeenCalledWith('1', expect.anything()));
  });

  it('contador vê a página; gestor e colaborador veem sem permissão', async () => {
    setup('contador');
    expect(screen.getByRole('heading', { name: 'Relatórios' })).toBeInTheDocument();
    expect(screen.queryByText('Sem permissão para esta tela')).toBeNull();
  });

  it('gestor não vê a página', () => {
    setup('gestor');
    expect(screen.getByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Horas extras/ })).toBeNull();
  });
});
