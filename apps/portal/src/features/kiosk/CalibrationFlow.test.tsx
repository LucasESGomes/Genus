import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCalibrationForm, CalibrationFlow } from './CalibrationFlow';
import { CAPTURE_INTERVAL_MS, COOLDOWN_TICKS } from './CaptureStage';
import { makeApi, renderKiosk } from './test-utils';

vi.mock('@/features/totems/camera/useTotemCamera', async () => {
  const { fakeCameraHandle } = await import('./test-utils');
  const handle = fakeCameraHandle();
  return { useTotemCamera: () => handle, meanAbsDiff: () => 0 };
});

afterEach(() => vi.useRealTimers());

function setup(api = makeApi()) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const props = { onSubmitted: vi.fn(), onCancel: vi.fn(), onKeyRejected: vi.fn() };
  const view = renderKiosk(<CalibrationFlow api={api} sessionId="7001" {...props} />);
  const click = (name: string) => user.click(screen.getByRole('button', { name }));
  return { api, click, ...props, ...view };
}

/** Deixa a captura automática tirar `n` fotos seguidas. */
async function shoot(n: number) {
  for (let i = 0; i < n * (COOLDOWN_TICKS + 2); i++) await act(() => vi.advanceTimersByTimeAsync(CAPTURE_INTERVAL_MS));
}

async function collect(click: (name: string) => Promise<void>) {
  await click('Já sei como funciona, pular');
  await shoot(3);
  expect(screen.getByRole('heading', { name: 'Pessoa 1 cadastrada' })).toBeInTheDocument();
  await click('Chamar a próxima pessoa');
  await shoot(3);
  await click('Ir para o grupo 2');
  await click('Chamar a primeira pessoa');
  for (let i = 1; i <= 3; i++) {
    await shoot(1);
    expect(screen.getByRole('heading', { name: `Pessoa ${i} registrada` })).toBeInTheDocument();
    await click(i < 3 ? 'Chamar a próxima pessoa' : 'Ir para o teste da foto');
  }
  await click('Estou com o celular pronto');
  await shoot(1);
  expect(screen.getByRole('heading', { name: '1 foto testada' })).toBeInTheDocument();
  await click('Concluir a coleta');
}

describe('Assistente de ajuste do totem', () => {
  it('explica as etapas, captura sozinho e envia o multipart do contrato', async () => {
    const { api, click, onSubmitted, container } = setup();
    expect(screen.getByRole('heading', { name: 'Chame 5 pessoas até aqui' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await click('Entendi, continuar');
    expect(screen.getByRole('heading', { name: '2 pessoas, 3 fotos de cada' })).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/limiar|embedding|liveness|impostor|threshold/i);
    await click('Voltar');
    await collect(click);

    expect(await screen.findByRole('heading', { name: 'Coleta concluída' })).toBeInTheDocument();
    const form = vi.mocked(api.submitCalibration).mock.calls[0]?.[0];
    expect(form?.get('sessionId')).toBe('7001');
    expect(form?.getAll('genuine').map((f) => (f as File).name)).toEqual(['p1_1.jpg', 'p1_2.jpg', 'p1_3.jpg', 'p2_1.jpg', 'p2_2.jpg', 'p2_3.jpg']);
    expect(form?.getAll('impostor')).toHaveLength(3);
    expect(form?.getAll('attack')).toHaveLength(1);

    await click('Voltar ao início');
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('cancelar no meio descarta as fotos e avisa o app', async () => {
    const { api, click, onCancel } = setup();
    await click('Já sei como funciona, pular');
    await shoot(1);
    await click('Cancelar');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(api.submitCalibration).not.toHaveBeenCalled();
  });

  it('falha no envio mantém as fotos e deixa tentar de novo', async () => {
    const submit = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ status: 'calculada' });
    const { click } = setup(makeApi({ submitCalibration: submit }));
    await collect(click);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível enviar agora');
    await click('Enviar de novo');
    expect(await screen.findByRole('heading', { name: 'Coleta concluída' })).toBeInTheDocument();
    expect((submit.mock.calls[1]?.[0] as FormData).getAll('genuine')).toHaveLength(6);
  });

  it('buildCalibrationForm nomeia os arquivos como o contrato', () => {
    const b = () => new Blob(['x']);
    const form = buildCalibrationForm('9', { people: [[b(), b()], [b()]], impostors: [b()], attacks: [b()] });
    expect(form.getAll('genuine').map((f) => (f as File).name)).toEqual(['p1_1.jpg', 'p1_2.jpg', 'p2_1.jpg']);
  });
});
