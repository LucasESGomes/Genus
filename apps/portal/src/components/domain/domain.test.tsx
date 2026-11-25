import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { House, User } from '@phosphor-icons/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { Punch, VacationCalendarRow } from '@/lib/api/contracts';
import { setRoute } from '../../../test/navigation';
import { BottomNav, ConnectionDot, DayTimeline, Minutes, PunchChips, RiskBadge, RiskBar, VacationGantt } from './index';

const TZ = 'America/Sao_Paulo';
const punch = (sequence: number, hhmm: string, origin: Punch['origin'] = 'original'): Punch => ({
  sequence,
  at: `2026-11-21T${hhmm}:00-03:00`,
  origin,
  nsr: sequence,
  adjustmentId: null,
});

describe('Minutes', () => {
  it('mostra HH:mm e descreve por extenso', async () => {
    const { container } = render(<><Minutes value={545} /><Minutes value={-150} emphasis="danger" /><Minutes value={30} signed emphasis="warn" /></>);
    expect(screen.getByText('09:05')).toBeInTheDocument();
    expect(screen.getByText('9 horas e 5 minutos')).toBeInTheDocument();
    expect(screen.getByText('-02:30')).toBeInTheDocument();
    expect(screen.getByText('+00:30')).toBeInTheDocument();
    expect(screen.getByText('mais 30 minutos')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PunchChips', () => {
  it('um chip por marcação, "ajustada" para as tratadas', async () => {
    const { container } = render(<PunchChips tz={TZ} punches={[punch(1, '08:00'), punch(2, '12:00'), punch(3, '13:00', 'tratada'), punch(4, '17:30')]} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.getByText('ajustada')).toBeInTheDocument();
    expect(screen.queryByText('sem saída')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
  it('número ímpar mostra "sem saída"', () => {
    render(<PunchChips tz={TZ} punches={[punch(1, '08:00'), punch(2, '12:00'), punch(3, '13:00')]} />);
    expect(screen.getByText('sem saída')).toBeInTheDocument();
  });
  it('sem marcações', () => {
    render(<PunchChips tz={TZ} punches={[]} />);
    expect(screen.getByText('Sem marcações')).toBeInTheDocument();
  });
});

describe('DayTimeline', () => {
  it('descreve os intervalos e a jornada prevista', async () => {
    const { container } = render(<DayTimeline tz={TZ} punches={[punch(1, '08:00'), punch(2, '12:00'), punch(3, '13:00'), punch(4, '17:00')]} expected={{ start: '08:00', end: '17:00' }} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName(/das 08:00 às 12:00; das 13:00 às 17:00.*Jornada prevista das 08:00 às 17:00/);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('batida sem par aparece como entrada sem saída', () => {
    render(<DayTimeline tz={TZ} punches={[punch(1, '08:00')]} />);
    expect(screen.getByRole('img')).toHaveAccessibleName(/entrada às 08:00 sem saída/);
  });
});

describe('RiskBadge / RiskBar', () => {
  it('o nível vem da prop, não da nota', async () => {
    const { container } = render(<><RiskBadge level="baixo" score={95} /><RiskBar level="alto" score={10} /></>);
    expect(screen.getByText('Risco baixo · 95')).toBeInTheDocument();
    const meter = screen.getByRole('meter', { name: 'Nota de risco' });
    expect(meter).toHaveAttribute('aria-valuenow', '10');
    expect(meter).toHaveAttribute('aria-valuetext', '10 de 100, risco alto');
    expect(screen.getByText('10/100 · Alto')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ConnectionDot', () => {
  it('ponto + texto para cada estado', async () => {
    const { container } = render(<><ConnectionDot connection="online" /><ConnectionDot connection="offline" /><ConnectionDot connection="inativo" /></>);
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Inativo')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BottomNav', () => {
  it('marca o item ativo com aria-current', async () => {
    setRoute('/me/ponto');
    const { container } = render(<BottomNav items={[{ href: '/me', label: 'Início', icon: House }, { href: '/me/ponto', label: 'Ponto', icon: User }]} />);
    expect(screen.getByRole('link', { name: 'Ponto' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current');
    expect(await axe(container)).toHaveNoViolations();
  });
});

const row = (over: Partial<VacationCalendarRow>): VacationCalendarRow => ({
  vacationId: '1', employeeId: '10', employeeName: 'Maria Souza', startDate: '2026-11-10', endDate: '2026-11-19',
  status: 'aprovada', exceedsLimit: false, nextFreeStartDate: null, ...over,
});

describe('VacationGantt', () => {
  const occupancy = Array.from({ length: 30 }, (_, i) => (i >= 9 && i <= 18 ? 2 : 0));
  it('uma faixa por pedido, marcador de hoje e ocupação acima do limite', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <VacationGantt
        month="2026-11"
        today="2026-11-21"
        maxSimultaneous={1}
        dailyOccupancy={occupancy}
        onSelect={onSelect}
        rows={[
          row({}),
          row({ vacationId: '2', employeeName: 'João Lima', status: 'solicitada', startDate: '2026-10-28', endDate: '2026-11-04', exceedsLimit: true }),
          row({ vacationId: '3', employeeName: 'Ana Reis', status: 'recusada', startDate: '2026-12-01', endDate: '2026-12-10' }),
        ]}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /21\/11, hoje/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Maria Souza, aprovada, 10\/11 a 19\/11/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /João Lima, solicitada/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ana Reis/ })).not.toBeInTheDocument();
    expect(screen.getByText('Passa do limite do setor')).toBeInTheDocument();
    expect(screen.getAllByText('acima do limite', { exact: false })).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: /Maria Souza/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ vacationId: '1' }));
    expect(await axe(container)).toHaveNoViolations();
  });
  it('sem onSelect as faixas são imagens descritas', () => {
    render(<VacationGantt month="2026-11" maxSimultaneous={2} dailyOccupancy={[]} rows={[row({})]} />);
    expect(screen.getByRole('img', { name: /Maria Souza, aprovada/ })).toBeInTheDocument();
  });
});
