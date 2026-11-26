'use client';
// Adaptado de visage/frontend/src/components/totem/TotemWizard.tsx (fonte somente leitura)
import { Check, X, type Icon } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import { cn } from '@/lib/utils';
import { COPY } from './copy';

export interface WizardStep {
  key: string;
  label: string;
  icon: Icon;
}

export function WizardBrand() {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <BrandMark />
      <span className="text-lg font-semibold tracking-tight">{COPY.brand}</span>
    </span>
  );
}

/** Tela branca com marca, botão de sair, stepper e o cartão do passo atual. */
export function WizardShell({ steps, current, contentKey, onExit, exitLabel, stage, children }: {
  steps: ReadonlyArray<WizardStep>;
  /** Passo atual. Fora da lista (telas finais), o stepper some. */
  current: string;
  contentKey: string;
  onExit: () => void;
  exitLabel: string;
  /** Palco de captura em tela cheia, fora do bloco animado (transform quebraria o position: fixed). */
  stage?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const index = steps.findIndex((s) => s.key === current);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-40 flex flex-col items-center overflow-y-auto bg-white px-4 py-5 md:px-8 md:py-6">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <WizardBrand />
        <button type="button" onClick={onExit} aria-label={exitLabel} className="cursor-pointer rounded-lg border-0 bg-transparent p-2.5 text-muted transition-colors hover:bg-skeleton-soft hover:text-ink">
          <X size={20} aria-hidden />
        </button>
      </div>
      {index >= 0 && (
        <ol aria-label={`Passo ${index + 1} de ${steps.length}`} className="m-0 mt-5 flex w-full max-w-2xl list-none items-center gap-2 p-0">
          {steps.map((s, i) => {
            const done = i < index;
            const active = i === index;
            return (
              <li key={s.key} aria-current={active ? 'step' : undefined} className="flex flex-1 flex-col gap-1.5">
                <span className={cn('h-1 rounded-full transition-colors duration-300', done ? 'bg-good' : active ? 'bg-brand' : 'bg-line')} />
                <span className={cn('flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.12em] uppercase', done ? 'text-good' : active ? 'text-brand' : 'text-muted')}>
                  {done ? <Check size={12} weight="bold" aria-hidden /> : <s.icon size={12} aria-hidden />}
                  <span className="sr-only sm:not-sr-only">{s.label}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {/* A key troca o cartão e anima só a entrada: o totem não pode travar esperando a saída. */}
      <div className="flex w-full max-w-2xl flex-1 items-center py-5 md:py-6">
        <div className="w-full">
          <motion.div key={contentKey} initial={{ opacity: 0, x: reduce ? 0 : 42 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 190, damping: 24 }} className="w-full">
            {children}
          </motion.div>
        </div>
      </div>
      {stage}
    </motion.div>
  );
}

/** Cartão final do fluxo: sucesso (check animado) ou desfecho neutro (com ícone). */
export function WizardOutcome({ icon, title, message, children }: { icon?: ReactNode; title: string; message: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-center rounded-2xl border border-line bg-white px-6 py-12 text-center shadow-lg">
      {icon ? (
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-skeleton text-muted">{icon}</span>
      ) : (
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 15 }}
          className="flex h-24 w-24 items-center justify-center rounded-full bg-good-bg text-good"
        >
          <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <motion.path initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" stroke="currentColor" />
          </svg>
        </motion.span>
      )}
      <h2 className={cn('m-0 mt-6 font-semibold tracking-tight text-ink', icon ? 'text-2xl' : 'text-3xl')}>{title}</h2>
      <p className="m-0 mt-2 max-w-sm text-[15px] leading-relaxed text-pretty text-muted">{message}</p>
      {children && <div className="mt-6 flex w-full max-w-sm flex-col gap-3">{children}</div>}
    </div>
  );
}
