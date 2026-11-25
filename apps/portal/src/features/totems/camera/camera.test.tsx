import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureCamera } from '@/features/kiosk/CaptureCamera';

const setSecure = (v: boolean | undefined) => Object.defineProperty(window, 'isSecureContext', { value: v, configurable: true });

function fakeStream() {
  const stop = vi.fn();
  return { stop, stream: { getTracks: () => [{ stop }, { stop }] } as unknown as MediaStream };
}

let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});
afterEach(() => setSecure(undefined));

describe('Câmera do totem', () => {
  it('em contexto inseguro mostra a mensagem e nunca chama getUserMedia', async () => {
    setSecure(false);
    render(<CaptureCamera onCapture={vi.fn()} />);
    expect(await screen.findByText(/só funciona em endereço seguro/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tirar foto' })).toBeDisabled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('abre ao montar e desmontar solta todas as trilhas', async () => {
    setSecure(true);
    const { stop, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = render(<CaptureCamera onCapture={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Imagem da câmera')).toBeInTheDocument());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: 'user' }) }));
    unmount();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('se a câmera abre depois do desmonte, é solta na hora', async () => {
    setSecure(true);
    const { stop, stream } = fakeStream();
    let resolve: (s: MediaStream) => void = () => undefined;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => { resolve = r; }));
    const { unmount } = render(<CaptureCamera onCapture={vi.fn()} />);
    unmount();
    resolve(stream);
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(2));
  });

  it('sem FaceDetector o botão Tirar foto é o caminho e o aviso pede para tocar nele', async () => {
    setSecure(true);
    getUserMedia.mockResolvedValue(fakeStream().stream);
    render(<CaptureCamera onCapture={vi.fn()} />);
    expect(await screen.findByText(/toque em Tirar foto/)).toBeInTheDocument();
  });

  it('erro de permissão mostra orientação e permite tentar de novo', async () => {
    setSecure(true);
    getUserMedia.mockRejectedValueOnce(new Error('negado'));
    render(<CaptureCamera onCapture={vi.fn()} />);
    expect(await screen.findByText(/Não conseguimos usar a câmera/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar abrir a câmera de novo' })).toBeInTheDocument();
  });
});
