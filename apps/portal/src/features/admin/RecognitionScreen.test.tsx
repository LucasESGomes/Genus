import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { ApiError } from '@/lib/api/errors';
import { mockMeFor } from '@/lib/api/mocks';
import { mockSuperAdminApi, resetMockSuperAdmin } from '@/lib/api/mocks/super-admin';
import { RECOGNITION_UNAVAILABLE_TEXT } from '@/lib/labels/super-admin';
import { currentRoute } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { RecognitionScreen } from './RecognitionScreen';

beforeEach(() => resetMockSuperAdmin());

type SA = NonNullable<ApiOverrides['superAdmin']>;
const render = (recognition: Partial<typeof mockSuperAdminApi.recognition> = {}, route = '/admin/reconhecimento') =>
  renderWithSession(<RecognitionScreen />, { me: mockMeFor('super_admin'), route, api: { superAdmin: { recognition: { ...mockSuperAdminApi.recognition, ...recognition } } as SA } });

describe('Reconhecimento', () => {
  it('mostra cartões, gráficos e aparelhos; as quatro métricas indisponíveis levam o texto; nenhum CPF', async () => {
    const { container } = render();
    expect(await screen.findByText('Portaria principal')).toBeInTheDocument();
    expect(screen.getByText('Batidas', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Relógio divergente')).toBeInTheDocument();
    expect(screen.getByText(/Mediana \(p50\) 1,45 · Pior 5% \(p05\) 1,08/)).toBeInTheDocument();
    expect(screen.getAllByText(RECOGNITION_UNAVAILABLE_TEXT)).toHaveLength(4);
    expect(screen.getByRole('img', { name: 'Histograma da nota de vivacidade' })).toBeInTheDocument();
    expect(screen.getAllByText('0,0–0,1').length).toBeGreaterThan(0);
    expect(screen.getByText('Batidas e falhas por hora')).toBeInTheDocument();
    expect(screen.getByText(/Só agregados/)).toBeInTheDocument();
    expect(screen.getByText('#5')).toBeInTheDocument(); // aparelho sem nome
    expect(container.textContent).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('janela e filtros vão para a URL e para a api; em 7d a série é por dia', async () => {
    const summary = vi.fn(mockSuperAdminApi.recognition.summary);
    const series = vi.fn(mockSuperAdminApi.recognition.series);
    const devices = vi.fn(mockSuperAdminApi.recognition.devices);
    render({ summary, series, devices });
    await screen.findByText('Portaria principal');
    expect(series).toHaveBeenLastCalledWith(expect.objectContaining({ window: '24h', bucket: 'hour' }), expect.anything());
    await userEvent.click(screen.getByRole('button', { name: '7d' }));
    expect(currentRoute()).toContain('janela=7d');
    await waitFor(() => expect(series).toHaveBeenLastCalledWith(expect.objectContaining({ window: '7d', bucket: 'day' }), expect.anything()));
    expect(await screen.findByText('Batidas e falhas por dia')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('ID do aparelho'), '2a');
    await waitFor(() => expect(currentRoute()).toContain('aparelho=2'));
    await waitFor(() => expect(devices).toHaveBeenLastCalledWith(expect.objectContaining({ deviceId: '2' }), expect.anything()));
    await waitFor(() => expect(screen.queryByText('Portaria principal')).toBeNull());
    expect(screen.getByText('Talhão 7')).toBeInTheDocument();
  });

  it('vazio sem batidas', async () => {
    const base = await mockSuperAdminApi.recognition.summary({});
    render({ summary: vi.fn(async () => ({ ...base, punches: 0 })) });
    expect(await screen.findByText('Sem batidas no período')).toBeInTheDocument();
  });

  it('erro com tentar de novo', async () => {
    const summary = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ summary });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
  });

  it('aparelhos vazios', async () => {
    render({ devices: vi.fn(async () => []) });
    expect(await screen.findByText('Nenhum aparelho com batidas')).toBeInTheDocument();
  });
});
