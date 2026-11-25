import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockMeFor } from '@/lib/api/mocks';
import { mockSuperAdminApi, resetMockSuperAdmin } from '@/lib/api/mocks/super-admin';
import { currentRoute } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { AuditScreen } from './AuditScreen';
import { diffStates } from './AuditDetailDialog';

beforeEach(() => resetMockSuperAdmin());

type SA = NonNullable<ApiOverrides['superAdmin']>;
const render = (audit: Partial<typeof mockSuperAdminApi.audit> = {}, route = '/admin/auditoria') =>
  renderWithSession(<AuditScreen />, { me: mockMeFor('super_admin'), route, api: { superAdmin: { audit: { ...mockSuperAdminApi.audit, ...audit } } as SA } });

const lastQuery = (list: ReturnType<typeof vi.fn>) => list.mock.calls.at(-1)?.[0];

describe('Auditoria', () => {
  it('carrega e mostra os registros, sem violação de acessibilidade', async () => {
    const { container } = render();
    expect(await screen.findByRole('row', { name: 'Abrir o registro de auditoria 11' })).toBeInTheDocument();
    const row = screen.getByRole('row', { name: 'Abrir o registro de auditoria 11' });
    expect(within(row).getByText('Alteração')).toBeInTheDocument();
    expect(within(row).getByText('Empresa')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('estado vazio', async () => {
    render({ list: vi.fn(async () => ({ data: [], meta: { nextCursor: null, limit: 25 } })) });
    expect(await screen.findByText('Nenhum registro de auditoria')).toBeInTheDocument();
  });

  it('erro com tentar de novo', async () => {
    const list = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ list });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it('filtros vão para a URL e para a api', async () => {
    const list = vi.fn(mockSuperAdminApi.audit.list);
    render({ list });
    await screen.findByRole('row', { name: 'Abrir o registro de auditoria 11' });
    await userEvent.selectOptions(screen.getByLabelText('Entidade'), 'session');
    expect(currentRoute()).toContain('entidade=session');
    await waitFor(() => expect(lastQuery(list)).toMatchObject({ entity: 'session', limit: 25 }));
    expect(await screen.findByRole('row', { name: 'Abrir o registro de auditoria 7' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Ação'), 'exclusao');
    expect(currentRoute()).toContain('acao=exclusao');
    await userEvent.type(screen.getByLabelText('ID do usuário'), '10x1');
    await waitFor(() => expect(currentRoute()).toContain('usuario=101'));
    await userEvent.type(screen.getByLabelText('De'), '2026-11-01');
    expect(currentRoute()).toContain('de=2026-11-01');
    await waitFor(() => expect(lastQuery(list)).toMatchObject({ userId: '101', action: 'exclusao', from: '2026-11-01T00:00:00-03:00' }));
  });

  it('recusa período maior que 90 dias com mensagem e sem chamar a api', async () => {
    const list = vi.fn(mockSuperAdminApi.audit.list);
    render({ list }, '/admin/auditoria?de=2026-01-01&ate=2026-11-01');
    expect(await screen.findByText('O período pode ter no máximo 90 dias.')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('Carregar mais busca a página seguinte pelo cursor', async () => {
    const all = (await mockSuperAdminApi.audit.list({ limit: 25 })).data;
    const list = vi.fn(async (q: { cursor?: string }) =>
      q.cursor ? { data: all.slice(2, 4), meta: { nextCursor: null, limit: 2 } } : { data: all.slice(0, 2), meta: { nextCursor: all[1]!.id, limit: 2 } });
    render({ list: list as never });
    await screen.findByRole('row', { name: `Abrir o registro de auditoria ${all[0]!.id}` });
    expect(screen.queryByRole('row', { name: `Abrir o registro de auditoria ${all[3]!.id}` })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByRole('row', { name: `Abrir o registro de auditoria ${all[3]!.id}` })).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: all[1]!.id }), expect.anything());
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('o detalhe mostra antes e depois lado a lado, com as chaves alteradas marcadas', async () => {
    const get = vi.fn(mockSuperAdminApi.audit.get);
    render({ get });
    await userEvent.click(await screen.findByRole('row', { name: 'Abrir o registro de auditoria 11' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('columnheader', { name: 'Antes' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('11', expect.anything());
    const ativo = within(dialog).getByRole('row', { name: /ativo/ });
    expect(ativo).toHaveAttribute('data-changed', 'true');
    expect(within(ativo).getByText('true')).toBeInTheDocument();
    expect(within(ativo).getByText('false')).toBeInTheDocument();
    expect(within(dialog).getByText('"Inadimplência há mais de 60 dias."')).toBeInTheDocument();
  });

  it('diffStates marca só o que mudou e mostra valores redigidos como vieram', () => {
    expect(diffStates({ a: 1, b: '[alterado]', c: 2 }, { a: 1, b: '[alterado]', c: 3, d: null })).toEqual([
      { key: 'a', before: '1', after: '1', changed: false },
      { key: 'b', before: '"[alterado]"', after: '"[alterado]"', changed: false },
      { key: 'c', before: '2', after: '3', changed: true },
      { key: 'd', before: null, after: 'null', changed: true },
    ]);
    expect(diffStates(null, null)).toEqual([]);
  });
});
