import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { MyCertificate } from '@/lib/api/contracts';
import { ApiError, toApiError } from '@/lib/api/errors';
import { mockEmployeePortalApi, resetEmployeePortalMock } from '@/lib/api/mocks/employee-portal';
import type { SubmitCertificateInput } from '@/lib/api/endpoints/employee-portal';
import { renderWithSession } from '../../../test/render';
import { CertificateScreen } from './CertificateScreen';

beforeEach(() => resetEmployeePortalMock());

const render = (over: Partial<typeof mockEmployeePortalApi> = {}) =>
  renderWithSession(<CertificateScreen />, { role: 'colaborador', route: '/me/atestado', api: { employeePortal: over } });

const png = (name = 'atestado.png') => new File(['x'], name, { type: 'image/png' });

async function pickFile(file: File = png()) {
  await userEvent.upload(screen.getByLabelText(/Foto ou arquivo do atestado/), file);
}
const setDate = (v = '2026-11-20') => fireEvent.change(screen.getByLabelText(/Primeiro dia de afastamento/), { target: { value: v } });
const send = () => userEvent.click(screen.getByRole('button', { name: 'Enviar atestado' }));

describe('Portal do funcionário: Atestado', () => {
  it('lista meus atestados com status e motivo da decisão', async () => {
    const { container } = render();
    expect(await screen.findByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('Recusado')).toBeInTheDocument();
    expect(screen.getByText('Aprovado')).toBeInTheDocument();
    expect(screen.getByText(/A imagem estava cortada/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nunca mostra CID, análise, risco nem texto lido, mesmo se o objeto trouxer campos a mais', async () => {
    const leaky = {
      id: '1', employeeId: '101', startDate: '2026-11-17', days: 1, hours: null, status: 'pendente', sentAt: '2026-11-18T11:30:00.000Z', decidedAt: null, decisionReason: null,
      cid: 'J11', cidCode: 'J11', analysis: { riskLevel: 'alto', summary: 'sinal de fraude' }, riskScore: 87, ocrText: 'Paciente com gripe', fileUrl: 'https://x/y',
    } as unknown as MyCertificate;
    const { container } = render({ certificates: vi.fn(async () => [leaky]) });
    await screen.findByText('Pendente');
    const text = container.ownerDocument.body.textContent ?? '';
    expect(text).not.toMatch(/J11|\bCID\b|risco|fraude|gripe|análise|\bOCR\b|\balto\b/i);
  });

  it('mostra o vazio da lista', async () => {
    render({ certificates: vi.fn(async () => []) });
    expect(await screen.findByText('Você ainda não enviou atestados.')).toBeInTheDocument();
  });

  it('erro na lista mostra "Tentar de novo" e busca de novo', async () => {
    const certificates = vi.fn(async () => { throw new ApiError('server', 503, 'HTTP_503', 'x'); });
    render({ certificates });
    await userEvent.click(await screen.findByRole('button', { name: /Tentar de novo/ }));
    await waitFor(() => expect(certificates).toHaveBeenCalledTimes(2));
  });

  it('403 e 404 da lista mostram a mesma tela de item não encontrado', async () => {
    render({ certificates: vi.fn(async () => { throw new ApiError('forbidden', 403, 'FORBIDDEN', 'x'); }) });
    expect(await screen.findByText('Item não encontrado')).toBeInTheDocument();
  });

  it('o botão de enviar tem alvo de 56 px e a aba Atestado fica marcada', async () => {
    render();
    expect(screen.getByRole('button', { name: 'Enviar atestado' })).toHaveClass('min-h-14');
    const nav = await screen.findByRole('navigation', { name: 'Navegação principal' });
    expect(within(nav).getByRole('link', { name: 'Atestado' })).toHaveAttribute('aria-current', 'page');
  });

  it('envia por dias: só days vai para a api, sem employeeId, e mostra o protocolo (id do atestado)', async () => {
    const created: MyCertificate = { id: '4242', employeeId: '101', startDate: '2026-11-20', days: 2, hours: null, status: 'pendente', sentAt: '2026-11-21T13:00:00.000Z', decidedAt: null, decisionReason: null };
    const submitCertificate = vi.fn(async () => created);
    render({ submitCertificate });
    const file = png();
    await pickFile(file);
    setDate();
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '2' } });
    await send();
    await waitFor(() => expect(submitCertificate).toHaveBeenCalledTimes(1));
    expect((submitCertificate.mock.calls as unknown as [SubmitCertificateInput][])[0]?.[0]).toEqual({ file, startDate: '2026-11-20', days: 2 });
    expect('hours' in ((submitCertificate.mock.calls as unknown as [SubmitCertificateInput][])[0]?.[0] ?? {})).toBe(false);
    expect(await screen.findByText('Atestado enviado')).toBeInTheDocument();
    expect(screen.getByText('Protocolo nº 4242')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar ao início' })).toHaveAttribute('href', '/me');
  });

  it('envia por horas: só hours vai para a api, com os dados opcionais do médico', async () => {
    const submitCertificate = vi.fn(mockEmployeePortalApi.submitCertificate);
    render({ submitCertificate });
    await pickFile();
    setDate();
    await userEvent.click(screen.getByRole('radio', { name: 'Horas' }));
    fireEvent.change(screen.getByLabelText(/Quantas horas/), { target: { value: '6' } });
    await userEvent.click(screen.getByText('Dados do médico (opcional)'));
    await userEvent.type(screen.getByLabelText('Nome do médico'), 'Dra. Ana Lima');
    await userEvent.type(screen.getByLabelText('CRM'), '12345');
    await userEvent.type(screen.getByLabelText('Estado do CRM'), 'sp');
    await send();
    await waitFor(() => expect(submitCertificate).toHaveBeenCalledTimes(1));
    const body = (submitCertificate.mock.calls as unknown as [SubmitCertificateInput][])[0]?.[0];
    expect(body).toMatchObject({ startDate: '2026-11-20', hours: 6, doctorName: 'Dra. Ana Lima', doctorCrm: '12345', doctorCrmUf: 'SP' });
    expect('days' in (body ?? {})).toBe(false);
  });

  it('dias de 1 a 365 e horas de 1 a 24: fora da faixa não chama a api', async () => {
    const submitCertificate = vi.fn(mockEmployeePortalApi.submitCertificate);
    render({ submitCertificate });
    await pickFile();
    setDate();
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '366' } });
    await send();
    expect(await screen.findByText('Informe de 1 a 365 dias.', { selector: 'p span' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '90' } });
    await userEvent.click(screen.getByRole('radio', { name: 'Horas' }));
    fireEvent.change(screen.getByLabelText(/Quantas horas/), { target: { value: '25' } });
    await send();
    expect(await screen.findByText('Informe de 1 a 24 horas.', { selector: 'p span' })).toBeInTheDocument();
    expect(submitCertificate).not.toHaveBeenCalled();
  });

  it('arquivo acima de 10 MB é recusado antes de chamar a api, com mensagem simples', async () => {
    const submitCertificate = vi.fn(mockEmployeePortalApi.submitCertificate);
    render({ submitCertificate });
    const big = png('grande.png');
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    await pickFile(big);
    expect(await screen.findByText(/O arquivo passa do limite de 10 MB/)).toBeInTheDocument();
    setDate();
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '1' } });
    await send();
    expect(submitCertificate).not.toHaveBeenCalled();
  });

  it('sem arquivo não envia e pede a foto', async () => {
    const submitCertificate = vi.fn(mockEmployeePortalApi.submitCertificate);
    render({ submitCertificate });
    setDate();
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '1' } });
    await send();
    expect(await screen.findByText('Escolha a foto ou o arquivo do atestado.')).toBeInTheDocument();
    expect(submitCertificate).not.toHaveBeenCalled();
  });

  it('"Fotografar" liga a câmera traseira no campo de arquivo', async () => {
    render();
    const input = screen.getByLabelText(/Foto ou arquivo do atestado/);
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf');
    expect(input).not.toHaveAttribute('capture');
    await userEvent.click(screen.getByRole('button', { name: 'Fotografar' }));
    expect(screen.getByLabelText(/Foto ou arquivo do atestado/)).toHaveAttribute('capture', 'environment');
  });

  it('422 da api (days/hours) aparece no campo "quantos"', async () => {
    const submitCertificate = vi.fn(async () => {
      throw toApiError(422, { code: 'VALIDATION_ERROR', error: 'Dados inválidos', details: [{ path: 'days', message: 'de 1 a 365 dias' }] });
    });
    render({ submitCertificate });
    await pickFile();
    setDate();
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '3' } });
    await send();
    expect(await screen.findByText('de 1 a 365 dias')).toBeInTheDocument();
  });

  it('o atestado novo aparece na lista depois do envio (mutação do mock)', async () => {
    const created = vi.fn(mockEmployeePortalApi.submitCertificate);
    render({ submitCertificate: created });
    await screen.findByText('Aprovado');
    await pickFile();
    setDate('2026-11-21');
    fireEvent.change(screen.getByLabelText(/Quantos dias/), { target: { value: '4' } });
    await send();
    await screen.findByText('Atestado enviado');
    await userEvent.click(screen.getByRole('button', { name: 'Enviar outro atestado' }));
    expect(await screen.findByText(/A partir de 21\/11\/2026 · 4 dias/)).toBeInTheDocument();
  });
});
