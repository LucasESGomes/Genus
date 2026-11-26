import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// Rota pública: fora do AuthGate, sem menu lateral. A identidade do aparelho é a chave guardada no próprio navegador.
// Título fixo: nunca nome nem CPF no <title>.
export const metadata: Metadata = { title: 'Genus Ponto', robots: { index: false, follow: false } };

// Tablet fixado na parede: sem zoom por gesto, UI estável.
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false };

export default function TotemLayout({ children }: { children: ReactNode }) {
  return children;
}
