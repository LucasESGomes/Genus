import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Rota pública: fora do AuthGate, sem menu lateral. A identidade do aparelho é a chave guardada no próprio navegador.
// Título fixo: nunca nome nem CPF no <title>.
export const metadata: Metadata = { title: 'Genus Ponto', robots: { index: false, follow: false } };

export default function TotemLayout({ children }: { children: ReactNode }) {
  return children;
}
