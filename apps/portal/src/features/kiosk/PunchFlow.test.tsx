import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUIDANCE_MS, PunchFlow, SUCCESS_MS } from './PunchFlow';
import { makeApi, renderKiosk } from './test-utils';

vi.mock('@/features/totems/camera/useTotemCamera', async () => {
  const { fakeCameraHandle } = await import('./test-utils');
  const handle = fakeCameraHandle();
  return { useTotemCamera: () => handle, meanAbsDiff: () => 0 };
});

afterEach(() => vi.useRealTimers());

describe('Registrar ponto: volta ao início sozinho', () => {
  it('depois do sucesso, volta em 4 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onDone = vi.fn();
    renderKiosk(<PunchFlow api={makeApi()} onDone={onDone} onKeyRejected={vi.fn()} />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await screen.findByRole('button', { name: 'Tirar foto' }));
    expect(await screen.findByRole('heading', { name: 'Ponto registrado' })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(SUCCESS_MS + 50); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('orientação sobre a foto fica mais tempo na tela', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const punch = vi.fn(async () => ({ outcome: 'fallback_required' as const, reason: 'no_face' as const, warnings: [] }));
    const onDone = vi.fn();
    renderKiosk(<PunchFlow api={makeApi({ punch })} onDone={onDone} onKeyRejected={vi.fn()} />);
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(await screen.findByRole('button', { name: 'Tirar foto' }));
    expect(await screen.findByRole('heading', { name: /Não encontramos um rosto/ })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(SUCCESS_MS + 50); });
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(GUIDANCE_MS); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
