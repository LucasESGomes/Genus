// Adaptado de visage/frontend/src/components/totem/calibrationIllustrations.tsx (fonte somente leitura)
//
// Versão enxuta, estática e só com tokens do Genus (a Visage usa hex). São decorativas: aria-hidden.
import type { ReactNode } from 'react';

function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 240 120" className={`h-auto w-full max-w-[240px] ${className}`}>
      <ellipse cx="120" cy="108" rx="100" ry="8" className="fill-tint" />
      {children}
    </svg>
  );
}

/** Pessoa sem rosto, em formas simples. A origem (x, y) é o centro da cabeça. */
function Person({ x, y = 40, shirt }: { x: number; y?: number; shirt: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="-9" y="22" width="18" height="38" rx="6" className={shirt} />
      <rect x="-8" y="52" width="6.5" height="26" rx="3" className="fill-brand" />
      <rect x="1.5" y="52" width="6.5" height="26" rx="3" className="fill-brand" />
      <circle r="12" className="fill-line-strong" />
    </g>
  );
}

/** Grupo 1: poucas pessoas, o totem fotografa cada uma algumas vezes. */
export function KnownGroupIllustration() {
  return (
    <Frame>
      <rect x="150" y="18" width="52" height="84" rx="9" className="fill-brand" />
      <rect x="156" y="25" width="40" height="64" rx="4" className="fill-white" />
      <circle cx="176" cy="52" r="10" className="fill-accent stroke-brand" />
      <Person x={70} shirt="fill-chart-2" />
      <Person x={105} shirt="fill-chart-3" />
    </Frame>
  );
}

/** Grupo 2: mais pessoas, uma foto de cada. */
export function OutsiderGroupIllustration() {
  return (
    <Frame>
      <rect x="168" y="18" width="52" height="84" rx="9" className="fill-brand" />
      <rect x="174" y="25" width="40" height="64" rx="4" className="fill-white" />
      <Person x={40} shirt="fill-faint" />
      <Person x={78} shirt="fill-chart-3" />
      <Person x={116} shirt="fill-chart-5" />
    </Frame>
  );
}

/** Teste da foto: um rosto na tela de um celular na frente do totem. */
export function ScreenAttackIllustration() {
  return (
    <Frame>
      <rect x="150" y="18" width="52" height="84" rx="9" className="fill-brand" />
      <rect x="156" y="25" width="40" height="64" rx="4" className="fill-white" />
      <rect x="62" y="34" width="40" height="64" rx="7" className="fill-brand" />
      <rect x="67" y="41" width="30" height="46" rx="3" className="fill-tint" />
      <circle cx="82" cy="60" r="9" className="fill-line-strong" />
    </Frame>
  );
}
