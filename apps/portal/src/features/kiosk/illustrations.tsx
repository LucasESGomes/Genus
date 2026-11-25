// Adaptado de visage/frontend/src/components/totem/calibrationIllustrations.tsx (fonte somente leitura)
//
// Ilustrações simples e estáticas (bonecos sem rosto), só com tokens do Genus. Decorativas: aria-hidden.
import type { ReactNode } from 'react';

function Person({ x, shirt = 'fill-brand', skin = 'fill-faint' }: { x: number; shirt?: string; skin?: string }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <rect x="-14" y="52" width="28" height="42" rx="10" className={shirt} />
      <circle cx="0" cy="34" r="15" className={skin} />
    </g>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 200 120" role="presentation" aria-hidden focusable="false" className="h-28 w-auto max-w-full">
      <rect x="4" y="4" width="192" height="112" rx="16" className="fill-tint" />
      {children}
    </svg>
  );
}

export type StepArt = 'one' | 'two' | 'many' | 'phone' | 'camera';

export function StepIllustration({ art }: { art: StepArt }) {
  if (art === 'one') {
    return (
      <Frame>
        <Person x={100} />
      </Frame>
    );
  }
  if (art === 'two') {
    return (
      <Frame>
        <Person x={70} shirt="fill-brand" />
        <Person x={130} shirt="fill-ink-2" skin="fill-muted" />
      </Frame>
    );
  }
  if (art === 'many') {
    return (
      <Frame>
        <Person x={50} />
        <Person x={100} shirt="fill-ink-2" skin="fill-muted" />
        <Person x={150} shirt="fill-muted" />
      </Frame>
    );
  }
  if (art === 'phone') {
    return (
      <Frame>
        <rect x="72" y="14" width="56" height="94" rx="10" className="fill-brand" />
        <rect x="78" y="24" width="44" height="72" rx="4" className="fill-white" />
        <circle cx="100" cy="52" r="11" className="fill-faint" />
        <rect x="88" y="68" width="24" height="18" rx="8" className="fill-faint" />
      </Frame>
    );
  }
  return (
    <Frame>
      <rect x="64" y="34" width="72" height="52" rx="12" className="fill-brand" />
      <circle cx="100" cy="60" r="16" className="fill-white" />
      <circle cx="100" cy="60" r="8" className="fill-brand" />
    </Frame>
  );
}
