import { TwoFactorSetup } from '@/features/admin/TwoFactorSetup';

/** Fora do grupo (painel): sem 2FA a sessão não passa pelo AuthGate (/auth/whoami responde 403 MFA_REQUIRED). */
export default function Page() {
  return <TwoFactorSetup />;
}
