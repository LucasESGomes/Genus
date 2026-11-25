import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { mockMeFor } from '@/lib/api/mocks';
import { ApiError } from '@/lib/api/errors';
import type { Role } from '@/lib/api/contracts';
import { router } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { LoginScreen } from './LoginScreen';
import { NoAccessScreen } from './NoAccessScreen';

type AuthOverrides = NonNullable<ApiOverrides['auth']>;

function setup(auth: AuthOverrides = {}, route = '/login', role: Exclude<Role, 'super_admin'> = 'rh') {
  const fns = {
    signIn: vi.fn(async () => ({ twoFactorRequired: false })),
    verifyTotp: vi.fn(async () => {}),
    me: vi.fn(async () => mockMeFor(role)),
    ...auth,
  };
  const view = renderWithSession(<LoginScreen />, { route, api: { auth: fns } });
  return { ...view, fns };
}

async function fillPassword(email = 'rh@exemplo.test', password = 'segredo-123') {
  await userEvent.type(screen.getByLabelText(/^E-mail/), email);
  await userEvent.type(screen.getByLabelText(/^Senha/), password);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

afterEach(() => vi.unstubAllEnvs());

describe('Login', () => {
  it('senha correta entra e vai para a tela inicial do papel', async () => {
    const { fns } = setup({}, '/login', 'contador');
    await fillPassword('contador@exemplo.test');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/rh/fechamento'));
    expect(fns.signIn).toHaveBeenCalledWith('contador@exemplo.test', 'segredo-123');
  });

  it('honra `next` só quando é um caminho seguro do portal', async () => {
    setup({}, '/login?next=%2Frh%2Fatestados');
    await fillPassword();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/rh/atestados'));
  });

  it('ignora `next` externo (//evil.com) e cai na tela do papel', async () => {
    setup({}, '/login?next=%2F%2Fevil.com');
    await fillPassword();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/rh'));
  });

  it('colaborador vai para /me', async () => {
    setup({}, '/login', 'colaborador');
    await fillPassword('colaborador@exemplo.test');
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/me'));
  });

  it('com 2FA pede o código e conclui com 6 dígitos', async () => {
    const { fns } = setup({ signIn: vi.fn(async () => ({ twoFactorRequired: true })) });
    await fillPassword('rh2fa@exemplo.test');
    const code = await screen.findByLabelText(/Código de verificação/);
    expect(code).toHaveAttribute('inputmode', 'numeric');
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    await waitFor(() => expect(fns.verifyTotp).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/rh'));
  });

  it('código errado mostra a mensagem e fica na etapa', async () => {
    setup({
      signIn: vi.fn(async () => ({ twoFactorRequired: true })),
      verifyTotp: vi.fn(async () => { throw new ApiError('unauthenticated', 401, 'INVALID_TWO_FACTOR_CODE', 'x'); }),
    });
    await fillPassword('rh2fa@exemplo.test');
    await userEvent.type(await screen.findByLabelText(/Código de verificação/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código inválido ou vencido');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('código com menos de 6 dígitos não chama a api', async () => {
    const { fns } = setup({ signIn: vi.fn(async () => ({ twoFactorRequired: true })) });
    await fillPassword('rh2fa@exemplo.test');
    await userEvent.type(await screen.findByLabelText(/Código de verificação/), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(await screen.findByText('O código tem 6 números.')).toBeInTheDocument();
    expect(fns.verifyTotp).not.toHaveBeenCalled();
  });

  it('credencial errada mostra mensagem genérica, sem repetir o e-mail', async () => {
    setup({ signIn: vi.fn(async () => { throw new ApiError('unauthenticated', 401, 'INVALID_EMAIL_OR_PASSWORD', 'x'); }) });
    await fillPassword('alguem@exemplo.test');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('E-mail ou senha incorretos');
    expect(alert).not.toHaveTextContent('alguem@exemplo.test');
  });

  it.each([
    ['429', new ApiError('server', 429, 'HTTP_429', 'x')],
    ['código BLOQUEAD', new ApiError('forbidden', 403, 'CONTA_BLOQUEADA', 'x')],
    ['código TOO_MANY', new ApiError('validation', 400, 'TOO_MANY_ATTEMPTS', 'x')],
  ])('conta bloqueada (%s) pede para aguardar', async (_n, err) => {
    setup({ signIn: vi.fn(async () => { throw err; }) });
    await fillPassword();
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas. Aguarde alguns minutos.');
  });

  it('falha de rede mostra aviso de conexão', async () => {
    setup({ signIn: vi.fn(async () => { throw new ApiError('network', 0, 'NETWORK', 'x'); }) });
    await fillPassword();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor');
  });

  it('campos vazios mostram erro de validação e não chamam a api', async () => {
    const { fns } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Informe o e-mail.')).toBeInTheDocument();
    expect(screen.getByText('Informe a senha.')).toBeInTheDocument();
    expect(fns.signIn).not.toHaveBeenCalled();
  });

  it('o botão fica desabilitado e ocupado enquanto envia', async () => {
    let release: (v: { twoFactorRequired: boolean }) => void = () => {};
    setup({ signIn: vi.fn(() => new Promise<{ twoFactorRequired: boolean }>((r) => { release = r; })) });
    await fillPassword();
    const button = await screen.findByRole('button', { name: 'Entrar' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute('aria-busy', 'true');
    release({ twoFactorRequired: false });
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('a senha não vai para a URL nem para o storage', async () => {
    setup();
    await fillPassword('rh@exemplo.test', 'senha-super-secreta');
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(JSON.stringify(router.replace.mock.calls)).not.toContain('senha-super-secreta');
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('senha-super-secreta');
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('senha-super-secreta');
  });

  it('"Esqueci a senha" fica desabilitado', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Esqueci a senha' })).toBeDisabled();
  });

  it('com `next` mostra que a sessão terminou; sem `next`, não', () => {
    const { unmount } = setup({}, '/login?next=%2Frh');
    expect(screen.getByRole('status')).toHaveTextContent('Sua sessão terminou. Entre de novo para continuar.');
    unmount();
    setup({}, '/login');
    expect(screen.queryByText(/Sua sessão terminou/)).not.toBeInTheDocument();
  });

  it('cartão de demonstração só aparece com mocks ligados', () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'true');
    const { unmount } = setup();
    expect(screen.getByText('Modo demonstração')).toBeInTheDocument();
    expect(screen.getByText('rh@exemplo.test')).toBeInTheDocument();
    unmount();
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', 'false');
    setup();
    expect(screen.queryByText('Modo demonstração')).not.toBeInTheDocument();
  });

  it('sem violações de acessibilidade (senha e código)', async () => {
    const { container } = setup({ signIn: vi.fn(async () => ({ twoFactorRequired: true })) });
    expect(await axe(container)).toHaveNoViolations();
    await fillPassword('rh2fa@exemplo.test');
    await screen.findByLabelText(/Código de verificação/);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Sem acesso', () => {
  it('mostra o 403 da conta e sai ao clicar em Sair', async () => {
    const signOut = vi.fn(async () => {});
    const { container } = renderWithSession(<NoAccessScreen />, { api: { auth: { signOut } } });
    expect(screen.getByText('Sem permissão para esta tela')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});
