import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { ClockProvider } from '@/lib/clock-context';
import { fixedClock } from '@/lib/clock';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { MonthPicker } from './MonthPicker';
import { PeriodPicker } from './PeriodPicker';
import { PendingBackTooltip } from './PendingBackTooltip';
import { SidePanel } from './SidePanel';

describe('Button', () => {
  it('accent, danger, size e loading', () => {
    const { rerender } = render(<Button variant="accent">Novo</Button>);
    expect(screen.getByRole('button', { name: 'Novo' })).toHaveClass('bg-accent', 'text-on-accent');
    rerender(<Button variant="danger" size="sm">Excluir</Button>);
    expect(screen.getByRole('button', { name: 'Excluir' })).toHaveClass('bg-danger', 'h-8');
    rerender(<Button loading>Salvar</Button>);
    const b = screen.getByRole('button', { name: 'Salvar' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
});

function Confirm(props: Partial<React.ComponentProps<typeof ConfirmDialog>>) {
  return <ConfirmDialog open onOpenChange={() => {}} title="Recusar ajuste" description="A pessoa será avisada." confirmLabel="Recusar" onConfirm={async () => {}} {...props} />;
}

describe('ConfirmDialog', () => {
  it('mantém confirmar desabilitado até o motivo ter o mínimo e entrega o motivo', async () => {
    const onConfirm = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(<Confirm reason={{ label: 'Motivo', min: 5 }} onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    const confirm = screen.getByRole('button', { name: 'Recusar' });
    expect(confirm).toBeDisabled();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: /Motivo/ }), 'abc');
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Motivo/ }), 'def');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('abcdef');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('exige digitar o texto igual', async () => {
    render(<Confirm typeToConfirm="FECHAR" />);
    const confirm = screen.getByRole('button', { name: 'Recusar' });
    const user = userEvent.setup();
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /FECHAR/ }), 'fechar');
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByRole('textbox', { name: /FECHAR/ }));
    await user.type(screen.getByRole('textbox', { name: /FECHAR/ }), 'FECHAR');
    expect(confirm).toBeEnabled();
  });

  it('mostra o erro da api sem fechar e desabilita enquanto pendente', async () => {
    let reject: (e: unknown) => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const onOpenChange = vi.fn();
    render(<Confirm onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeDisabled();
    reject(new ApiError('conflict', 409, 'CONFLITO', 'O período já está fechado.'));
    expect(await screen.findByRole('alert')).toHaveTextContent('O período já está fechado.');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeEnabled();
  });

  it('sem violações de acessibilidade', async () => {
    render(<Confirm reason={{ label: 'Motivo', max: 200 }} tone="danger" />);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('SidePanel', () => {
  it('mostra título, conteúdo e rodapé e avisa o fechamento', async () => {
    const onOpenChange = vi.fn();
    render(<SidePanel open onOpenChange={onOpenChange} title="Atestado" description="Detalhes" footer={<Button>Aprovar</Button>}>corpo</SidePanel>);
    expect(screen.getByRole('dialog', { name: 'Atestado' })).toBeInTheDocument();
    expect(screen.getByText('corpo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('PeriodPicker', () => {
  const clock = fixedClock('2026-11-21T13:00:00.000Z');
  const renderIt = (onChange = vi.fn()) => {
    const utils = render(<ClockProvider clock={clock}><PeriodPicker value={{ from: '2026-11-01', to: '2026-11-21' }} onChange={onChange} /></ClockProvider>);
    return { ...utils, onChange };
  };
  it('presets usam o Clock', async () => {
    const { onChange } = renderIt();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Período/ }));
    await user.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-10-01', to: '2026-10-31' });
    await user.click(screen.getByRole('button', { name: /Período/ }));
    await user.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-15', to: '2026-11-21' });
    await user.click(screen.getByRole('button', { name: /Período/ }));
    await user.click(screen.getByRole('button', { name: 'Este mês' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '2026-11-01', to: '2026-11-21' });
  });
  it('personalizado recusa data final antes da inicial', async () => {
    const { onChange } = renderIt();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Período/ }));
    const to = screen.getByLabelText('Até');
    await user.clear(to);
    await user.type(to, '2026-10-01');
    expect(screen.getByText('A data final vem antes da inicial.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('MonthPicker', () => {
  it('navega e mostra o mês por extenso', async () => {
    const onChange = vi.fn();
    const { container } = render(<MonthPicker value="2026-11" onChange={onChange} />);
    expect(screen.getByText('novembro de 2026')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-12');
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }));
    expect(onChange).toHaveBeenLastCalledWith('2026-10');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PendingBackTooltip', () => {
  it('botão desabilitado mostra "Aguardando back" ao receber foco', async () => {
    const { container } = render(<PendingBackTooltip><Button disabled>Prévia</Button></PendingBackTooltip>);
    expect(screen.getByRole('button', { name: 'Prévia' })).toBeDisabled();
    await userEvent.tab();
    expect((await screen.findAllByText('Aguardando back')).length).toBeGreaterThan(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});
