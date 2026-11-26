import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { KIOSK_KEY_STORAGE } from '@/lib/api/kiosk';
import { toApiError } from '@/lib/api/errors';
import { KioskApp } from './KioskApp';
import { CONTEXT, makeApi, memoryKeyStore, renderKiosk } from './test-utils';

vi.mock('@/features/totems/camera/useTotemCamera', async () => {
  const { fakeCameraHandle } = await import('./test-utils');
  const handle = fakeCameraHandle();
  return { useTotemCamera: () => handle, meanAbsDiff: () => 0 };
});

const keyRejected = () => toApiError(401, { code: 'CHAVE_APARELHO_INVALIDA', error: 'Chave inválida' });

describe('Totem: chave do aparelho', () => {
  it('chave válida: valida pelo contexto, guarda a chave e mostra estabelecimento e aparelho', async () => {
    const keyStore = memoryKeyStore();
    const api = makeApi();
    const { container } = renderKiosk(<KioskApp api={api} keyStore={keyStore} />);
    expect(await screen.findByRole('heading', { name: 'Conectar este aparelho' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.type(screen.getByLabelText('Chave do aparelho'), 'gk_0123456789abcdef0123456789abcdef01234567');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));

    expect(await screen.findByRole('heading', { name: 'Fazenda Boa Vista' })).toBeInTheDocument();
    expect(screen.getByText('Totem da portaria')).toBeInTheDocument();
    expect(keyStore.value()).toBe('gk_0123456789abcdef0123456789abcdef01234567');
    expect(api.context).toHaveBeenCalled();
  });

  it('chave inválida: mostra a mensagem e não guarda nada', async () => {
    const keyStore = memoryKeyStore();
    const api = makeApi({ context: vi.fn(async () => { throw keyRejected(); }) });
    renderKiosk(<KioskApp api={api} keyStore={keyStore} />);
    await userEvent.type(await screen.findByLabelText('Chave do aparelho'), 'gk_errada');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chave inválida ou aparelho desativado');
    expect(keyStore.value()).toBeNull();
  });

  it('sem internet na validação: avisa e não guarda a chave', async () => {
    const keyStore = memoryKeyStore();
    const api = makeApi({ context: vi.fn(async () => { throw new ApiError('network', 0, 'NETWORK', 'x'); }) });
    renderKiosk(<KioskApp api={api} keyStore={keyStore} />);
    await userEvent.type(await screen.findByLabelText('Chave do aparelho'), 'gk_qualquer');
    await userEvent.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
    expect(keyStore.value()).toBeNull();
  });

  it('Desconectar apaga a chave do aparelho e volta para a tela da chave (e só mostra o começo da chave)', async () => {
    window.localStorage.setItem(KIOSK_KEY_STORAGE, 'gk_0123456789abcdef');
    const keyStore = memoryKeyStore('gk_0123456789abcdef');
    renderKiosk(<KioskApp api={makeApi()} keyStore={keyStore} />);
    await screen.findByRole('heading', { name: 'Fazenda Boa Vista' });
    const brand = screen.getByRole('button', { name: 'Genus' });
    for (let i = 0; i < 5; i++) await userEvent.click(brand);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('gk_01234…')).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent('0123456789abcdef');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Desconectar este aparelho' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    expect(await screen.findByRole('heading', { name: 'Conectar este aparelho' })).toBeInTheDocument();
    expect(keyStore.value()).toBeNull();
  });

  it('o armazenamento real usa genus.totem.key', async () => {
    const { kioskKeyStore } = await import('@/lib/api/kiosk');
    kioskKeyStore.set('gk_abc');
    expect(window.localStorage.getItem('genus.totem.key')).toBe('gk_abc');
    kioskKeyStore.clear();
    expect(window.localStorage.getItem('genus.totem.key')).toBeNull();
  });

  it('401 ao consultar o contexto volta para a tela da chave e apaga a chave', async () => {
    const keyStore = memoryKeyStore('gk_velha');
    const api = makeApi({ context: vi.fn(async () => { throw keyRejected(); }) });
    renderKiosk(<KioskApp api={api} keyStore={keyStore} />);
    expect(await screen.findByRole('heading', { name: 'Conectar este aparelho' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('foi desconectado');
    expect(keyStore.value()).toBeNull();
  });
});

describe('Totem: início', () => {
  it('mostra o relógio fixo no fuso de São Paulo, os dois botões e passa no axe', async () => {
    const { container } = renderKiosk(<KioskApp api={makeApi()} keyStore={memoryKeyStore('gk_x1234567')} />);
    expect(await screen.findByRole('heading', { name: 'Fazenda Boa Vista' })).toBeInTheDocument();
    expect(screen.getByTestId('kiosk-clock')).toHaveTextContent('10:00:00');
    expect(screen.getByText(/sábado, 21 de novembro/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Registrar ponto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cadastrar meu rosto' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('sem conexão: mostra o aviso com "Tentar de novo" e não quebra', async () => {
    const context = vi.fn().mockRejectedValueOnce(new ApiError('network', 0, 'NETWORK', 'x')).mockResolvedValue(CONTEXT);
    renderKiosk(<KioskApp api={makeApi({ context })} keyStore={memoryKeyStore('gk_x1234567')} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sem conexão');
    expect(screen.getByRole('button', { name: 'Registrar ponto' })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('heading', { name: 'Fazenda Boa Vista' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('calibração aguardando: entra sozinho no assistente', async () => {
    const context = vi.fn(async () => ({ ...CONTEXT, calibration: { sessionId: '7001', status: 'aguardando' } }));
    renderKiosk(<KioskApp api={makeApi({ context })} keyStore={memoryKeyStore('gk_x1234567')} />);
    expect(await screen.findByRole('heading', { name: 'Chame 5 pessoas até aqui' })).toBeInTheDocument();
  });

  it('"Agora não" dispensa a sessão e não reabre o assistente', async () => {
    const context = vi.fn(async () => ({ ...CONTEXT, calibration: { sessionId: '7001', status: 'aguardando' } }));
    renderKiosk(<KioskApp api={makeApi({ context })} keyStore={memoryKeyStore('gk_x1234567')} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Agora não' }));
    expect(await screen.findByRole('heading', { name: 'Fazenda Boa Vista' })).toBeInTheDocument();
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('heading', { name: 'Chame 5 pessoas até aqui' })).not.toBeInTheDocument();
  });
});

describe('Totem: registrar ponto', () => {
  async function openPunch(api = makeApi()) {
    const view = renderKiosk(<KioskApp api={api} keyStore={memoryKeyStore('gk_x1234567')} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar ponto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Tirar foto' }));
    return { api, ...view };
  }

  it('sucesso: mostra primeiro nome e hora, nunca fala em proibido', async () => {
    const { api } = await openPunch();
    expect(await screen.findByRole('heading', { name: 'Ponto registrado' })).toBeInTheDocument();
    expect(screen.getByText('João · 10:00')).toBeInTheDocument();
    expect(api.punch).toHaveBeenCalledWith(expect.any(Blob));
    expect(document.body).not.toHaveTextContent(/proibid|bloquead|negad/i);
  });

  it('não reconhecido: orienta sobre a foto e deixa tentar de novo', async () => {
    const punch = vi.fn(async () => ({ outcome: 'fallback_required' as const, reason: 'not_recognized' as const, warnings: [] }));
    await openPunch(makeApi({ punch }));
    expect(await screen.findByRole('heading', { name: 'Não reconhecemos seu rosto. Tente de novo com o rosto de frente e bem iluminado.' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Tirar foto' })).toBeInTheDocument();
  });

  it('antifraude reprovada: mostra o texto exato', async () => {
    const punch = vi.fn(async () => ({ outcome: 'fallback_required' as const, reason: 'liveness_failed' as const, warnings: [] }));
    await openPunch(makeApi({ punch }));
    expect(await screen.findByRole('heading', { name: 'Verificação antifraude reprovada. Tente novamente.' })).toBeInTheDocument();
  });

  it('sem internet ao enviar: mensagem amigável e tentar de novo', async () => {
    const punch = vi.fn(async () => { throw new ApiError('network', 0, 'NETWORK', 'x'); });
    await openPunch(makeApi({ punch }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão. Tente de novo.');
  });

  it('chave recusada no meio do ponto volta para a tela da chave', async () => {
    const punch = vi.fn(async () => { throw keyRejected(); });
    await openPunch(makeApi({ punch }));
    expect(await screen.findByRole('heading', { name: 'Conectar este aparelho' })).toBeInTheDocument();
  });

  it('passa no axe na câmera', async () => {
    const view = renderKiosk(<KioskApp api={makeApi()} keyStore={memoryKeyStore('gk_x1234567')} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar ponto' }));
    await screen.findByRole('button', { name: 'Tirar foto' });
    expect(await axe(view.container)).toHaveNoViolations();
  });
});

