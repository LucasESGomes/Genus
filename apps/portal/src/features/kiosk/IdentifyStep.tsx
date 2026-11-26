'use client';
// Adaptado de IdentifierStep (visage/frontend/src/components/totem/TotemWizard.tsx): CPF + PIN com teclado na tela.
import { WarningCircle } from '@phosphor-icons/react';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { COPY } from './copy';
import { Keypad, maskCpf, onlyDigits } from './Keypad';
import { CARD, CARD_TITLE, EYEBROW, PRIMARY_BUTTON } from './ui';

const CPF_LENGTH = 11;
const PIN_MIN = 4;
const PIN_MAX = 6;

export function IdentifyStep({ cpf, pin, onCpf, onPin, error, attempt, busy, onSubmit }: {
  cpf: string;
  pin: string;
  onCpf: (v: string) => void;
  onPin: (v: string) => void;
  error: string | null;
  /** Cresce a cada recusa: repete a animação de erro. */
  attempt: number;
  busy: boolean;
  onSubmit: () => void;
}) {
  const reduce = useReducedMotion();
  const [field, setField] = useState<'cpf' | 'pin'>('cpf');
  const ready = cpf.length === CPF_LENGTH && pin.length >= PIN_MIN;

  const type = (d: string) => {
    if (field === 'pin') return onPin((pin + d).slice(0, PIN_MAX));
    const next = (cpf + d).slice(0, CPF_LENGTH);
    onCpf(next);
    if (next.length === CPF_LENGTH) setField('pin');
  };
  const erase = () => {
    if (field === 'cpf') return onCpf(cpf.slice(0, -1));
    if (!pin) return setField('cpf');
    onPin(pin.slice(0, -1));
  };

  const input = (active: boolean) =>
    cn(
      'h-14 w-full rounded-xl border bg-white text-center font-mono text-xl text-ink shadow-xs transition-colors placeholder:text-line-hover focus:outline-none',
      error ? 'border-danger' : active ? 'border-brand shadow-focus' : 'border-line-strong',
    );
  // Sentido alternado: a animação repete a cada recusa sem remontar os campos (não perde o foco).
  const side = attempt % 2 === 0 ? 1 : -1;

  return (
    <div className={CARD}>
      <p className={EYEBROW}>{COPY.enroll.eyebrow}</p>
      <h2 className={CARD_TITLE}>{COPY.enroll.identifyTitle}</h2>
      <p className="m-0 mt-2 text-[15px] text-muted">{COPY.enroll.identifyText}</p>
      <form
        className="mx-auto mt-6 flex max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onSubmit();
        }}
      >
        <motion.div animate={{ x: error && !reduce ? [0, -12 * side, 12 * side, -8 * side, 8 * side, 0] : 0 }} transition={{ duration: 0.45 }} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
            {COPY.enroll.cpfLabel}
            <input
              value={maskCpf(cpf)}
              onChange={(e) => onCpf(onlyDigits(e.target.value).slice(0, CPF_LENGTH))}
              onFocus={() => setField('cpf')}
              inputMode="none"
              autoComplete="off"
              placeholder="000.000.000-00"
              aria-invalid={error ? true : undefined}
              className={cn(input(field === 'cpf'), 'tracking-[0.05em]')}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink-2">
            {COPY.enroll.pinLabel}
            <input
              type="password"
              value={pin}
              onChange={(e) => onPin(onlyDigits(e.target.value).slice(0, PIN_MAX))}
              onFocus={() => setField('pin')}
              inputMode="none"
              autoComplete="off"
              placeholder="••••"
              aria-invalid={error ? true : undefined}
              className={cn(input(field === 'pin'), 'tracking-[0.4em]')}
            />
          </label>
        </motion.div>
        {error && (
          <motion.p role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="m-0 flex items-start gap-2 rounded-lg border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">
            <WarningCircle size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </motion.p>
        )}
        <Keypad onDigit={type} onBackspace={erase} disabled={busy} />
        <button type="submit" disabled={!ready || busy} className={cn(PRIMARY_BUTTON, 'mt-2')}>
          {busy ? COPY.enroll.checking : COPY.enroll.next}
        </button>
      </form>
    </div>
  );
}
