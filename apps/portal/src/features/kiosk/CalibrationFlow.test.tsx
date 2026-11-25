import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { buildCalibrationForm, CalibrationFlow } from './CalibrationFlow';
import { makeApi, renderKiosk } from './test-utils';

vi.mock('@/features/totems/camera/useTotemCamera', async () => {
  const { fakeCameraHandle } = await import('./test-utils');
  const handle = fakeCameraHandle();
  return { useTotemCamera: () => handle, meanAbsDiff: () => 0 };
});

const click = (name: string) => userEvent.click(screen.getByRole('button', { name }));

async function takeShots(n: number) {
  for (let i = 0; i < n; i++) await userEvent.click(await screen.findByRole('button', { name: 'Tirar foto' }));
}

describe('Assistente de ajuste do totem', () => {
  it('percorre as quatro etapas, mostra o contador e envia o multipart do contrato', async () => {
    const api = makeApi();
    const onSubmitted = vi.fn();
    const { container } = renderKiosk(<CalibrationFlow api={api} sessionId="7001" onSubmitted={onSubmitted} onCancel={vi.fn()} onKeyRejected={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Ajuste do totem' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await click('Começar');

    expect(screen.getByRole('heading', { name: 'Pessoa 1: fique de frente' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await click('Continuar');
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(await screen.findByRole('button', { name: 'Tirar foto' }));
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    await takeShots(2);

    expect(await screen.findByRole('heading', { name: 'Pessoa 2: agora outra pessoa' })).toBeInTheDocument();
    await click('Continuar');
    await takeShots(3);

    expect(await screen.findByRole('heading', { name: 'Mais pessoas diferentes: cada uma olha uma vez' })).toBeInTheDocument();
    await click('Continuar');
    await takeShots(3);

    expect(await screen.findByRole('heading', { name: 'Mostre uma foto de um rosto na tela de um celular' })).toBeInTheDocument();
    await click('Continuar');
    expect(screen.getByText('1 de 2')).toBeInTheDocument();
    await takeShots(2);

    // Revisão: só contagens.
    expect(await screen.findByRole('heading', { name: 'Confira antes de enviar' })).toBeInTheDocument();
    expect(screen.getByText('Pessoa 1: 3 fotos')).toBeInTheDocument();
    expect(screen.getByText('Foto na tela do celular: 2 fotos')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await click('Enviar');
    expect(await screen.findByRole('heading', { name: 'Pronto!' })).toBeInTheDocument();
    expect(screen.getByText('O administrador vai revisar o resultado no painel.')).toBeInTheDocument();

    const form = vi.mocked(api.submitCalibration).mock.calls[0]?.[0];
    expect(form?.get('sessionId')).toBe('7001');
    expect(form?.getAll('genuine').map((f) => (f as File).name)).toEqual(['p1_1.jpg', 'p1_2.jpg', 'p1_3.jpg', 'p2_1.jpg', 'p2_2.jpg', 'p2_3.jpg']);
    expect(form?.getAll('impostor')).toHaveLength(3);
    expect(form?.getAll('attack')).toHaveLength(2);

    await click('Voltar ao início');
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('não usa termos técnicos na tela', async () => {
    renderKiosk(<CalibrationFlow api={makeApi()} sessionId="7001" onSubmitted={vi.fn()} onCancel={vi.fn()} onKeyRejected={vi.fn()} />);
    await click('Começar');
    await click('Continuar');
    expect(document.body.textContent ?? '').not.toMatch(/limiar|embedding|liveness|impostor|threshold/i);
  });

  it('cancelar no meio descarta as fotos e avisa o app', async () => {
    const api = makeApi();
    const onCancel = vi.fn();
    renderKiosk(<CalibrationFlow api={api} sessionId="7001" onSubmitted={vi.fn()} onCancel={onCancel} onKeyRejected={vi.fn()} />);
    await click('Começar');
    await click('Continuar');
    await takeShots(1);
    await click('Cancelar');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(api.submitCalibration).not.toHaveBeenCalled();
  });

  it('falha no envio mantém as fotos e deixa tentar de novo', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ status: 'calculada' });
    const api = makeApi({ submitCalibration: submit });
    renderKiosk(<CalibrationFlow api={api} sessionId="7001" onSubmitted={vi.fn()} onCancel={vi.fn()} onKeyRejected={vi.fn()} />);
    await click('Começar');
    for (const n of [3, 3, 3, 2]) {
      await click('Continuar');
      await takeShots(n);
    }
    await click('Enviar');
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar agora');
    expect(screen.getByText('Pessoa 1: 3 fotos')).toBeInTheDocument();
    await click('Enviar');
    expect(await screen.findByRole('heading', { name: 'Pronto!' })).toBeInTheDocument();
  });

  it('buildCalibrationForm nomeia os arquivos como o contrato', () => {
    const b = () => new Blob(['x']);
    const form = buildCalibrationForm('9', { p1: [b(), b()], p2: [b()], others: [b()], screen: [b()] });
    expect(form.getAll('genuine').map((f) => (f as File).name)).toEqual(['p1_1.jpg', 'p1_2.jpg', 'p2_1.jpg']);
  });
});
