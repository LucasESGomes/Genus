'use client';
import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './shadcn/tooltip';

/**
 * Envolve um botão desabilitado de prévia: botão desabilitado não recebe foco nem hover, então
 * o gatilho é um span focável ao redor dele. `text` explica o que falta (padrão: "Aguardando back").
 */
export function PendingBackTooltip({ children, text = 'Aguardando back' }: { children: ReactNode; text?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="inline-flex">{children}</span>
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
