import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { SESSION_KEY } from '@/lib/auth/gate';
import { router } from '../../../test/navigation';
import { renderWithSession, type ApiOverrides } from '../../../test/render';
import { extractSecret, groupSecret, TwoFactorSetup } from './TwoFactorSetup';

const URI = 'otpauth://totp/Genus:superadmin%40exemplo.test?secret=JBSWY3DPEHPK3PXP&issuer=Genus';
const CODES = ['aaaaa-bbbbb', 'ccccc-ddddd'];

function setup(auth2fa: NonNullable<ApiOverrides['superAdmin']>['auth2fa'] = undefined) {
  const enable = vi.fn(async () => ({ totpURI: URI, backupCodes: CODES }));
  const verify = vi.fn(async () => {});
  const view = renderWithSession(<TwoFactorSetup />, {
    route: '/admin/ativar-2fa',
    api: { superAdmin: { auth2fa: auth2fa ?? { enable, verify } } },
  });
  return { ...view, enable, verify };
}

async function passStep(password = 'senha-secreta') {
  await userEvent.type(screen.getByLabelText(/^Senha/), password);
  await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
}

describe('helpers', () => {
  it('extrai a chave do endereço e agrupa de 4 em 4', () => {
    expect(extractSecret(URI)).toBe('JBSWY3DPEHPK3PXP');
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDEFGHI')).toBe('ABCD EFGH I');
  });
});

describe('Ativar 2FA', () => {
  it('pede a senha, mostra a chave e os códigos, e só libera o código depois da confirmação', async () => {
    const { enable } = setup();
    await passStep();
    expect(enable).toHaveBeenCalledWith('senha-secreta');
    expect(await screen.findByTestId('totp-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(screen.getByTestId('backup-codes')).toHaveTextContent('aaaaa-bbbbb');
    expect(screen.getByText(/QR em breve/)).toBeInTheDocument();
    expect(screen.getByText(/otpauth completo/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Senha/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Código de 6 dígitos/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ativar 2FA' })).toBeDisabled();
  });
  it('código certo ativa, invalida a sessão e vai para /admin sem deixar chave nem códigos na tela', async () => {
    const { verify, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await passStep();
    await screen.findByTestId('totp-secret');
    await userEvent.click(screen.getByRole('checkbox', { name: /Guardei os códigos/ }));
    await userEvent.type(screen.getByLabelText(/Código de 6 dígitos/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Ativar 2FA' }));
    await waitFor(() => expect(verify).toHaveBeenCalledWith('123456'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/admin'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: SESSION_KEY });
    expect(screen.queryByTestId('totp-secret')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('aaaaa-bbbbb');
    expect(JSON.stringify({ ...window.localStorage, ...window.sessionStorage })).not.toContain('JBSW');
  });
  it('código errado mostra a mensagem e fica na etapa', async () => {
    setup({
      enable: vi.fn(async () => ({ totpURI: URI, backupCodes: CODES })),
      verify: vi.fn(async () => { throw new ApiError('unauthenticated', 401, 'INVALID_TWO_FACTOR_CODE', 'x'); }),
    });
    await passStep();
    await screen.findByTestId('totp-secret');
    await userEvent.click(screen.getByRole('checkbox', { name: /Guardei os códigos/ }));
    await userEvent.type(screen.getByLabelText(/Código de 6 dígitos/), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Ativar 2FA' }));
    expect(await screen.findByText(/Código inválido ou vencido/)).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalledWith('/admin');
  });
  it('senha errada mostra a mensagem e continua pedindo a senha', async () => {
    setup({ enable: vi.fn(async () => { throw new ApiError('validation', 400, 'INVALID_PASSWORD', 'x'); }), verify: vi.fn(async () => {}) });
    await passStep('errada');
    expect(await screen.findByText(/Senha incorreta/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Senha/)).toHaveValue('');
    expect(screen.queryByTestId('totp-secret')).not.toBeInTheDocument();
  });
});
