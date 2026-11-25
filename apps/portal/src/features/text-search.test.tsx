/**
 * Busca por texto nas tabelas longas: um chamado à api com `q` depois de 300 ms, nada com menos de 2 caracteres,
 * volta à página 1, `q` fora da URL e estado vazio sem repetir CPF. Telas: colaboradores, ajustes, atestados,
 * apuração do dia, escalas, banco de horas e totens.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockAdjustmentsApi } from '@/lib/api/mocks/adjustments';
import { mockCertificatesApi } from '@/lib/api/mocks/certificates';
import { mockDevicesApi, resetMockDevices } from '@/lib/api/mocks/devices';
import { mockEmployeesApi } from '@/lib/api/mocks/employees';
import { mockSchedulesApi } from '@/lib/api/mocks/schedules';
import { mockTimeBankApi } from '@/lib/api/mocks/time-bank';
import { mockTimesheetsApi } from '@/lib/api/mocks/timesheets';
import { currentRoute } from '../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../test/render';
import { AdjustmentsScreen } from './adjustments/AdjustmentsScreen';
import { CertificatesScreen } from './certificates/CertificatesScreen';
import { EmployeesScreen } from './employees/EmployeesScreen';
import { SchedulesScreen } from './schedules/SchedulesScreen';
import { DayScreen } from './timesheets/DayScreen';
import { TimeBankScreen } from './time-bank/TimeBankScreen';
import { DevicesScreen } from './totems/DevicesScreen';

interface Case {
  name: string;
  route: string;
  searchLabel: RegExp;
  ui: () => ReactElement;
  /** Monta o override do módulo com um espião no método de listagem e devolve o espião. */
  spy: () => { api: ApiOverrides; list: ReturnType<typeof vi.fn> };
}

const CASES: Case[] = [
  {
    name: 'Colaboradores', route: '/rh/colaboradores', searchLabel: /Buscar colaborador/, ui: () => <EmployeesScreen />,
    spy: () => { const list = vi.fn(mockEmployeesApi.list); return { list, api: { employees: { list } } }; },
  },
  {
    name: 'Ajustes', route: '/rh/ajustes', searchLabel: /Buscar ajuste/, ui: () => <AdjustmentsScreen />,
    spy: () => { const list = vi.fn(mockAdjustmentsApi.list); return { list, api: { adjustments: { list } } }; },
  },
  {
    name: 'Atestados', route: '/rh/atestados', searchLabel: /Buscar atestado/, ui: () => <CertificatesScreen />,
    spy: () => { const list = vi.fn(mockCertificatesApi.list); return { list, api: { certificates: { list } } }; },
  },
  {
    name: 'Apuração do dia', route: '/rh/apuracao?date=2026-11-21', searchLabel: /Buscar colaborador/, ui: () => <DayScreen />,
    spy: () => { const list = vi.fn(mockTimesheetsApi.day); return { list, api: { timesheets: { day: list } } }; },
  },
  {
    name: 'Escalas', route: '/rh/escalas', searchLabel: /Buscar escala/, ui: () => <SchedulesScreen />,
    spy: () => { const list = vi.fn(mockSchedulesApi.list); return { list, api: { schedules: { list } } }; },
  },
  {
    name: 'Banco de horas', route: '/rh/banco-horas', searchLabel: /Buscar colaborador/, ui: () => <TimeBankScreen />,
    spy: () => { const list = vi.fn(mockTimeBankApi.balances); return { list, api: { timeBank: { balances: list } } }; },
  },
  {
    name: 'Totens', route: '/rh/totens', searchLabel: /Buscar totem/, ui: () => <DevicesScreen />,
    spy: () => { const list = vi.fn(mockDevicesApi.list); return { list, api: { devices: { list } } }; },
  },
];

/** Chamadas da listagem com q (as contagens das abas usam pageSize 1 e ficam de fora). */
const withQ = (list: ReturnType<typeof vi.fn>) => list.mock.calls.filter(([arg]) => (arg as { q?: string; pageSize?: number }).q !== undefined && (arg as { pageSize?: number }).pageSize !== 1);
const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  resetMockDevices();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => vi.useRealTimers());

describe.each(CASES)('Busca por texto: $name', (c) => {
  it('digitar manda UM chamado com q só depois de 300 ms', async () => {
    const { list, api } = c.spy();
    renderWithSession(c.ui(), { route: c.route, api });
    const box = await screen.findByRole('searchbox', { name: c.searchLabel });
    await waitFor(() => expect(list).toHaveBeenCalled());
    await user().type(box, 'maria');
    await advance(250);
    expect(withQ(list)).toHaveLength(0);
    await advance(100);
    await waitFor(() => expect(withQ(list)).toHaveLength(1));
    expect(withQ(list)[0]?.[0]).toMatchObject({ q: 'maria' });
    await advance(1000);
    expect(withQ(list)).toHaveLength(1);
  });

  it('com menos de 2 caracteres não manda q', async () => {
    const { list, api } = c.spy();
    renderWithSession(c.ui(), { route: c.route, api });
    const box = await screen.findByRole('searchbox', { name: c.searchLabel });
    await user().type(box, 'm');
    await advance(600);
    expect(withQ(list)).toHaveLength(0);
  });

  it('o texto buscado nunca vai para a URL', async () => {
    const { list, api } = c.spy();
    renderWithSession(c.ui(), { route: c.route, api });
    const box = await screen.findByRole('searchbox', { name: c.searchLabel });
    await user().type(box, 'maria');
    await advance(400);
    await waitFor(() => expect(withQ(list)).toHaveLength(1));
    expect(currentRoute()).not.toMatch(/maria|q=/);
  });

  it('sem resultado mostra "Nenhum resultado para" e não repete CPF', async () => {
    const { api } = c.spy();
    renderWithSession(c.ui(), { route: c.route, api });
    const box = await screen.findByRole('searchbox', { name: c.searchLabel });
    await user().type(box, 'zzzxyz');
    await advance(400);
    expect(await screen.findByText(/Nenhum resultado para “zzzxyz”/)).toBeInTheDocument();
    await user().clear(box);
    await user().type(box, '52998224725');
    await advance(400);
    expect(await screen.findByText('Nenhum resultado para a busca')).toBeInTheDocument();
    expect(screen.queryByText(/52998224725/)).toBeNull();
  });
});

describe('Busca por texto: filtra de verdade nos mocks', () => {
  it('colaboradores: sem acento, por nome ou matrícula', async () => {
    const { list, api } = CASES[0]!.spy();
    renderWithSession(<EmployeesScreen />, { route: '/rh/colaboradores', api });
    await user().type(await screen.findByRole('searchbox', { name: /Buscar colaborador/ }), 'antonio');
    await advance(400);
    expect(await screen.findByText('Antônio Carlos Ferreira')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('João Pereira')).toBeNull());
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'antonio' }), expect.anything());
  });

  it('mostra "Buscando…" enquanto o texto ainda não foi enviado', async () => {
    const { api } = CASES[0]!.spy();
    renderWithSession(<EmployeesScreen />, { route: '/rh/colaboradores', api });
    await user().type(await screen.findByRole('searchbox', { name: /Buscar colaborador/ }), 'ma');
    expect(screen.getByText('Buscando…')).toBeInTheDocument();
    await advance(400);
    await waitFor(() => expect(screen.queryByText('Buscando…')).toBeNull());
  });

  it('trocar o q volta para a página 1', async () => {
    const { api } = CASES[0]!.spy();
    renderWithSession(<EmployeesScreen />, { route: '/rh/colaboradores?page=2', api });
    await user().type(await screen.findByRole('searchbox', { name: /Buscar colaborador/ }), 'ma');
    await advance(400);
    await waitFor(() => expect(currentRoute()).not.toContain('page='));
  });
});
