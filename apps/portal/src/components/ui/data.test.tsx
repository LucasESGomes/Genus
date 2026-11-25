import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError, HIDDEN_RESOURCE_MESSAGE, toApiError, unavailableError } from '@/lib/api/errors';
import { CountTabs } from './CountTabs';
import { DataTable } from './DataTable';
import { Pagination } from './Pagination';
import { QueryView } from './QueryView';
import { ComingSoonState, ErrorBanner, NotFoundState } from './States';

interface Row { id: string; name: string; days: number }
const ROWS: Row[] = [{ id: '1', name: 'Maria Souza', days: 3 }, { id: '2', name: 'João Lima', days: 5 }];
const COLUMNS: ColumnDef<Row, never>[] = [
  { accessorKey: 'name', header: 'Nome' },
  { accessorKey: 'days', header: 'Dias' },
];

describe('DataTable', () => {
  it('renderiza tabela semântica com caption e th scope=col', async () => {
    const { container } = render(<DataTable caption="Pessoas" columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} />);
    expect(screen.getByRole('table', { name: 'Pessoas' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute('scope', 'col');
    expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('clique e Enter na linha chamam onRowClick; a selecionada leva aria-current', async () => {
    const onRowClick = vi.fn();
    const { container } = render(
      <DataTable caption="Pessoas" columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} onRowClick={onRowClick} rowLabel={(r) => `Abrir ${r.name}`} selectedId="2" />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('row', { name: 'Abrir Maria Souza' }));
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);
    screen.getByRole('row', { name: 'Abrir João Lima' }).focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);
    expect(screen.getByRole('row', { name: 'Abrir João Lima' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('row', { name: 'Abrir Maria Souza' })).not.toHaveAttribute('aria-current');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('mostra esqueleto, vazio e rodapé', () => {
    const { rerender } = render(<DataTable caption="Pessoas" columns={COLUMNS} data={[]} getRowId={(r) => r.id} loadingRows={3} />);
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
    rerender(<DataTable caption="Pessoas" columns={COLUMNS} data={[]} getRowId={(r) => r.id} empty={<p>Nada aqui</p>} footer={<span>Rodapé</span>} />);
    expect(screen.getByText('Nada aqui')).toBeInTheDocument();
    expect(screen.getByText('Rodapé')).toBeInTheDocument();
  });

  it('ordena no cliente quando sortable', async () => {
    render(<DataTable caption="Pessoas" columns={COLUMNS} data={ROWS} getRowId={(r) => r.id} sortable />);
    await userEvent.click(screen.getByRole('button', { name: 'Nome' }));
    const first = screen.getAllByRole('row')[1]!;
    expect(within(first).getByText('João Lima')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Nome' })).toHaveAttribute('aria-sort', 'ascending');
  });
});

describe('Pagination', () => {
  it('mostra "1–25 de 412" e troca de página', async () => {
    const onPageChange = vi.fn();
    const { container } = render(<Pagination meta={{ page: 1, pageSize: 25, total: 412 }} onPageChange={onPageChange} />);
    expect(screen.getByText('1–25 de 412')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(await axe(container)).toHaveNoViolations();
  });
  it('última página corta no total', () => {
    render(<Pagination meta={{ page: 17, pageSize: 25, total: 412 }} onPageChange={() => {}} />);
    expect(screen.getByText('401–412 de 412')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  });
});

describe('CountTabs', () => {
  function Harness() {
    const [v, setV] = useState<'a' | 'b'>('a');
    return <CountTabs label="Situação" value={v} onChange={setV} items={[{ value: 'a', label: 'Pendentes', count: 12, attention: true }, { value: 'b', label: 'Decididos', count: 3 }]} />;
  }
  it('ponto de atenção tem texto acessível e troca de aba por clique e seta', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('tab', { name: /Pendentes/ })).toHaveTextContent('requer atenção');
    expect(screen.getByRole('tab', { name: /Decididos/ })).not.toHaveTextContent('requer atenção');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Decididos/ }));
    expect(screen.getByRole('tab', { name: /Decididos/ })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: /Pendentes/ })).toHaveAttribute('aria-selected', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('CountTabs: sem barra vertical e ponto sólido', () => {
  it('rola só na horizontal, sem barra visível, e o ponto de atenção não tem borda nem anel', () => {
    render(<CountTabs label="Situação" value="a" onChange={() => {}} items={[{ value: 'a', label: 'Pendentes', count: 1, attention: true }, { value: 'b', label: 'Outras' }]} />);
    const list = screen.getByRole('tablist');
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('overflow-y-hidden');
    const dot = within(screen.getByRole('tab', { name: /Pendentes/ })).getByText('requer atenção').previousElementSibling as HTMLElement;
    expect(dot.className).toContain('bg-accent');
    expect(dot.className).not.toMatch(/border|ring|outline|shadow/);
  });
});

describe('estados', () => {
  it('NotFoundState usa a mensagem única de 403/404; ComingSoon e ErrorBanner', async () => {
    const onRetry = vi.fn();
    const { container } = render(<><NotFoundState /><ComingSoonState what="os atestados" /><ErrorBanner what="os atestados" onRetry={onRetry} /></>);
    expect(screen.getByText(HIDDEN_RESOURCE_MESSAGE)).toBeInTheDocument();
    expect(screen.getByText(/Em breve: os atestados/)).toBeInTheDocument();
    expect(screen.getByText(/Esta parte ainda está sendo construída no servidor/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(onRetry).toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});

function Probe({ fn, options }: { fn: () => Promise<string[]>; options?: { retry?: false } }) {
  const query = useQuery<string[], ApiError>({ queryKey: ['t'], queryFn: fn, retry: false, ...options });
  return (
    <QueryView query={query} what="os itens" loading={<p>carregando…</p>} isEmpty={(d) => d.length === 0} empty={<p>vazio</p>}>
      {(d) => <ul>{d.map((x) => <li key={x}>{x}</li>)}</ul>}
    </QueryView>
  );
}
const wrap = (ui: ReactNode, qc = new QueryClient()) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;

describe('QueryView', () => {
  it('pending → loading, depois sucesso', async () => {
    render(wrap(<Probe fn={async () => ['a', 'b']} />));
    expect(screen.getByText('carregando…')).toBeInTheDocument();
    expect(await screen.findByText('a')).toBeInTheDocument();
  });
  it('vazio', async () => {
    render(wrap(<Probe fn={async () => []} />));
    expect(await screen.findByText('vazio')).toBeInTheDocument();
  });
  it('403 e 404 mostram o MESMO texto', async () => {
    const texts: string[] = [];
    for (const status of [403, 404]) {
      const { unmount } = render(wrap(<Probe fn={async () => { throw toApiError(status, { error: 'x', code: 'X' }); }} />, new QueryClient()));
      const el = await screen.findByText(HIDDEN_RESOURCE_MESSAGE);
      texts.push(el.textContent ?? '');
      unmount();
    }
    expect(texts[0]).toBe(texts[1]);
  });
  it('unavailable → Em breve', async () => {
    render(wrap(<Probe fn={async () => { throw unavailableError(); }} />));
    expect(await screen.findByText(/Em breve/)).toBeInTheDocument();
  });
  it('erro com retry', async () => {
    const fn = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(toApiError(500, {})).mockResolvedValueOnce(['ok']);
    const { container } = render(wrap(<Probe fn={fn} />));
    const retry = await screen.findByRole('button', { name: 'Tentar de novo' });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(retry);
    expect(await screen.findByText('ok')).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('refetch com erro mantém o dado antigo e mostra o aviso', async () => {
    const qc = new QueryClient();
    const fn = vi.fn<() => Promise<string[]>>().mockResolvedValueOnce(['antigo']).mockRejectedValueOnce(toApiError(500, {}));
    render(wrap(<Probe fn={fn} />, qc));
    expect(await screen.findByText('antigo')).toBeInTheDocument();
    await qc.refetchQueries({ queryKey: ['t'] });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('antigo')).toBeInTheDocument();
  });
});
