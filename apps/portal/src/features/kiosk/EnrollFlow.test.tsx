import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, toApiError } from '@/lib/api/errors';
import { CAPTURE_INTERVAL_MS, COOLDOWN_TICKS } from './CaptureStage';
import { CONSENT_TEXT_VERSION } from './copy';
import { KioskApp } from './KioskApp';
import { makeApi, memoryKeyStore, renderKiosk } from './test-utils';

vi.mock('@/features/totems/camera/useTotemCamera', async () => {
  const { fakeCameraHandle } = await import('./test-utils');
  const handle = fakeCameraHandle();
  return { useTotemCamera: () => handle, meanAbsDiff: () => 0 };
});

afterEach(() => vi.useRealTimers());

async function openEnroll(api = makeApi()) {
  const view = renderKiosk(<KioskApp api={api} keyStore={memoryKeyStore('gk_x1234567')} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar meu rosto' }));
  return { api, ...view };
}

async function identify(cpf = '00000000101', pin = '483920') {
  await userEvent.type(screen.getByLabelText('CPF'), cpf);
  await userEvent.type(screen.getByLabelText('PIN'), pin);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('Totem: cadastrar meu rosto', () => {
  it('caminho feliz: confere CPF e PIN, pede consentimento, tira 3 fotos sozinho e envia', async () => {
    const { api, container } = await openEnroll();
    expect(await axe(container)).toHaveNoViolations();
    await identify();
    expect(await screen.findByRole('heading', { name: 'Olá, Ana!' })).toBeInTheDocument();
    expect(api.verifyIdentity).toHaveBeenCalledWith({ cpf: '00000000101', pin: '483920' });
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Sou eu, continuar' }));
    const terms = screen.getByRole('region', { name: 'Termo de consentimento' });
    expect(terms).toHaveTextContent('ao RH da sua empresa');
    expect(terms).toHaveTextContent('guardada para auditoria');
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Aceito e quero continuar' }));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Iniciar câmera' }));
    for (let i = 0; i < 3 * (COOLDOWN_TICKS + 2); i++) await act(() => vi.advanceTimersByTimeAsync(CAPTURE_INTERVAL_MS));
    expect(await screen.findByRole('heading', { name: 'Cadastro concluído' })).toBeInTheDocument();

    const form = vi.mocked(api.enroll).mock.calls[0]?.[0];
    expect(form?.get('cpf')).toBe('00000000101');
    expect(form?.get('pin')).toBe('483920');
    expect(form?.get('consentAccepted')).toBe('true');
    expect(form?.get('consentTextVersion')).toBe(CONSENT_TEXT_VERSION);
    expect(form?.getAll('photos')).toHaveLength(3);
  });

  it('CPF ou PIN errado: avisa na hora, na mesma etapa, e deixa corrigir', async () => {
    const verifyIdentity = vi
      .fn()
      .mockRejectedValueOnce(toApiError(401, { code: 'CPF_OU_PIN_INVALIDO', error: 'CPF ou PIN inválido.' }))
      .mockResolvedValue({ firstName: 'Ana', alreadyEnrolled: true });
    const { api } = await openEnroll(makeApi({ verifyIdentity }));
    await identify('99999999999', '1111');
    expect(await screen.findByRole('alert')).toHaveTextContent('CPF ou PIN inválido. Confira e tente de novo.');
    expect(screen.getByRole('heading', { name: 'Vamos te identificar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aceito e quero continuar' })).not.toBeInTheDocument();
    expect(api.enroll).not.toHaveBeenCalled();
    // 401 de CPF/PIN NÃO é chave recusada: continua conectado.
    expect(screen.queryByRole('heading', { name: 'Conectar este aparelho' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('PIN'), '2');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(/cadastro anterior será substituído/)).toBeInTheDocument();
  });

  it('muitas tentativas: mostra a mensagem do servidor', async () => {
    const verifyIdentity = vi.fn(async () => {
      throw new ApiError('server', 429, 'MUITAS_TENTATIVAS', 'Muitas tentativas. Aguarde 1 minuto.');
    });
    await openEnroll(makeApi({ verifyIdentity }));
    await identify();
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas. Aguarde 1 minuto.');
  });

  it('recusar o termo não coleta nada', async () => {
    const { api } = await openEnroll();
    await identify();
    await userEvent.click(await screen.findByRole('button', { name: 'Sou eu, continuar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Não aceito' }));
    expect(screen.getByRole('heading', { name: 'Sem problema' })).toBeInTheDocument();
    expect(api.enroll).not.toHaveBeenCalled();
  });

  it('teclado na tela mascara o CPF, passa para o PIN e exige 4 números', async () => {
    await openEnroll();
    const pad = screen.getByRole('group', { name: 'Teclado numérico' });
    const press = async (digits: string) => {
      for (const d of digits) await userEvent.click(within(pad).getByRole('button', { name: d }));
    };
    await press('123456789');
    expect(screen.getByLabelText('CPF')).toHaveValue('123.456.789');
    await userEvent.click(within(pad).getByRole('button', { name: 'Apagar' }));
    expect(screen.getByLabelText('CPF')).toHaveValue('123.456.78');
    await press('901123');
    expect(screen.getByLabelText('PIN')).toHaveValue('123');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    await press('4');
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  it('cancelar volta ao início e apaga CPF e PIN da memória', async () => {
    await openEnroll();
    await userEvent.type(screen.getByLabelText('CPF'), '00000000101');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cadastrar meu rosto' }));
    expect(screen.getByLabelText('CPF')).toHaveValue('');
  });
});
