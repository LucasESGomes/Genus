import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureStage } from '@/features/kiosk/CaptureStage';

const setSecure = (v: boolean | undefined) => Object.defineProperty(window, 'isSecureContext', { value: v, configurable: true });

function fakeStream() {
  const stop = vi.fn();
  return { stop, stream: { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream };
}

const stage = () => <CaptureStage icon={null} title="Ana" instruction="Olhe para o centro" totalSteps={3} completedSteps={0} acceptedTick={0} onCapture={vi.fn()} />;

let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});
afterEach(() => setSecure(undefined));

describe('Câmera do totem', () => {
  it('em contexto inseguro mostra a mensagem e nunca chama getUserMedia', async () => {
    setSecure(false);
    render(stage());
    expect(await screen.findByText(/só funciona em endereço seguro/)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('abre ao montar e desmontar solta todas as trilhas', async () => {
    setSecure(true);
    const { stop, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(stage());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }) }));
    expect(await screen.findByText('Olhe para o centro')).toBeInTheDocument();
    unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('se a câmera abre depois do desmonte, é solta na hora', async () => {
    setSecure(true);
    const { stop, stream } = fakeStream();
    let resolve: (s: MediaStream) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => { resolve = r; }));
    const { unmount } = render(stage());
    unmount();
    resolve(stream);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  });

  it('erro de permissão mostra orientação e permite tentar de novo', async () => {
    setSecure(true);
    getUserMedia.mockRejectedValueOnce(new Error('negado'));
    render(stage());
    expect(await screen.findByText(/Não conseguimos usar a câmera/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar abrir a câmera de novo' })).toBeInTheDocument();
  });
});
