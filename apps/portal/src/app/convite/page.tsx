import type { Metadata } from 'next';
import { AcceptInviteScreen } from '@/features/invites/AcceptInviteScreen';

// Rota pública: fora do AuthGate. Título fixo: nunca nome nem CPF no <title>.
export const metadata: Metadata = { title: 'Genus RH', referrer: 'no-referrer', robots: { index: false, follow: false } };

export default function Page() {
  return <AcceptInviteScreen />;
}
