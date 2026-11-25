import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Absence, Role } from '@/lib/api/contracts';
import { ApiError } from '@/lib/api/errors';
import { mockAbsencesApi } from '@/lib/api/mocks/absences';
import { mockTimesheetsApi } from '@/lib/api/mocks/timesheets';
import { renderWithSession } from '../../../test/render';
import { AbsencesSection } from './AbsencesSection';

function setup(opts: { id?: string; role?: Exclude<Role, 'super_admin'>; list?: typeof mockAbsencesApi.list; create?: typeof mockAbsencesApi.create } = {}) {
  const { id = '107', role = 'rh', list = mockAbsencesApi.list, create = mockAbsencesApi.create } = opts;
  const listFn = vi.fn(list);
  const createFn = vi.fn(create);
  const view = renderWithSession(<AbsencesSection employeeId={id} />, { role, api: { absences: { list: listFn, create: createFn } } });
  return { ...view, listFn, createFn };
}

async function pickType(label: string) {
  await userEvent.click(screen.getByRole('combobox', { name: /Tipo/ }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}
const type = async (label: string, value: string) => {
  const input = screen.getByLabelText(new RegExp(label));
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

describe('Afastamentos', () => {
  it('lista "Afastado de D1 a D2" com o tipo, sem axe violations', async () => {
    const { container } = setup();
    expect(await screen.findByText('Afastado de 02/03/2026 a 29/06/2026')).toBeInTheDocument();
    expect(screen.getByText('· Licença-maternidade')).toBeInTheDocument();
    expect(screen.getByText('Afastado no dia 14/10/2026')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('atestado aparece só como tipo, sem diagnóstico', async () => {
    const a: Absence = { id: '1', employeeId: '107', type: 'atestado', startDate: '2026-11-02', endDate: '2026-11-04', certificateId: '7' };
    setup({ role: 'admin', list: async () => [a] });
    expect(await screen.findByText('· Atestado')).toBeInTheDocument();
    expect(screen.queryByText(/CID|diagn/i)).toBeNull();
  });

  it('vazio, erro com retry e 404', async () => {
    const empty = setup({ list: async () => [] });
    expect(await screen.findByText(/Nenhum afastamento registrado/)).toBeInTheDocument();
    empty.unmount();
    const err = setup({ list: async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); } });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(err.listFn.mock.calls.length).toBeGreaterThanOrEqual(2));
    err.unmount();
    setup({ list: async () => { throw new ApiError('not_found', 404, 'NOT_FOUND', 'x'); } });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('só o rh registra afastamento', async () => {
    const rh = setup();
    expect(await screen.findByRole('button', { name: 'Registrar afastamento' })).toBeInTheDocument();
    rh.unmount();
    for (const role of ['admin', 'gestor'] as const) {
      const v = setup({ role });
      await screen.findByText(/Afastado de/);
      expect(screen.queryByRole('button', { name: 'Registrar afastamento' })).toBeNull();
      v.unmount();
    }
  });

  it('o formulário não aceita último dia antes do primeiro e não chama a api', async () => {
    const { createFn } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar afastamento' }));
    await pickType('Casamento');
    await type('Primeiro dia', '2026-11-10');
    await type('Último dia', '2026-11-05');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('O último dia não pode vir antes do primeiro.')).toBeInTheDocument();
    expect(createFn).not.toHaveBeenCalled();
  });

  it('não oferece "atestado" como tipo manual', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar afastamento' }));
    await userEvent.click(screen.getByRole('combobox', { name: /Tipo/ }));
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(8);
    expect(options.map((o) => o.textContent)).not.toContain('Atestado');
  });

  it('registra com o corpo certo e a leitura seguinte já traz o afastamento (mock muda o estado)', async () => {
    const { createFn, listFn } = setup({ id: '108' });
    await screen.findByText(/Nenhum afastamento registrado/);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar afastamento' }));
    await pickType('Casamento');
    await type('Primeiro dia', '2026-11-09');
    await type('Último dia', '2026-11-13');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() => expect(createFn).toHaveBeenCalledWith('108', { type: 'casamento', startDate: '2026-11-09', endDate: '2026-11-13' }));
    expect(await screen.findByText('Afastado de 09/11/2026 a 13/11/2026')).toBeInTheDocument();
    expect(listFn.mock.calls.length).toBeGreaterThanOrEqual(2);
    // o espelho do mesmo colaborador passa a mostrar os dias como afastamento
    const days = await mockTimesheetsApi.byEmployee('108', { from: '2026-11-09', to: '2026-11-13' });
    expect(days.every((d) => d.situation === 'afastamento')).toBe(true);
  });

  it('afastamento sobreposto volta 409 e a mensagem aparece no painel', async () => {
    setup({ id: '107' });
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar afastamento' }));
    await pickType('Óbito');
    await type('Primeiro dia', '2026-03-10');
    await type('Último dia', '2026-03-12');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    const panel = await screen.findByRole('dialog');
    expect(await within(panel).findByRole('alert')).toHaveTextContent('O afastamento se sobrepõe a outro do colaborador');
  });

  it('422 da api cai no campo', async () => {
    setup({
      create: async () => { throw new ApiError('validation', 422, 'VALIDATION_ERROR', 'Dados inválidos', [{ path: 'endDate', message: 'fim antes do início' }]); },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar afastamento' }));
    await pickType('Outro');
    await type('Primeiro dia', '2026-11-09');
    await type('Último dia', '2026-11-10');
    await userEvent.click(screen.getByRole('button', { name: 'Registrar' }));
    expect(await screen.findByText('fim antes do início')).toBeInTheDocument();
  });
});
