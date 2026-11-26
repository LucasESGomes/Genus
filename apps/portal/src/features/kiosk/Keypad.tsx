'use client';
import { Backspace } from '@phosphor-icons/react';
import { motion } from 'framer-motion';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const KEY = 'flex h-14 cursor-pointer items-center justify-center rounded-xl border border-line-strong bg-white font-mono text-2xl font-semibold text-ink shadow-xs transition-colors hover:bg-surface active:bg-tint disabled:cursor-not-allowed disabled:opacity-50';

/** Teclado numérico grande. Quem usa guarda os dígitos só em memória. */
export function Keypad({ onDigit, onBackspace, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; disabled?: boolean }) {
  const key = (d: string) => (
    <motion.button key={d} type="button" whileTap={{ scale: 0.95 }} className={KEY} disabled={disabled} onClick={() => onDigit(d)}>{d}</motion.button>
  );
  return (
    <div role="group" aria-label="Teclado numérico" className="grid grid-cols-3 gap-2">
      {DIGITS.map(key)}
      <span aria-hidden />
      {key('0')}
      <motion.button type="button" whileTap={{ scale: 0.95 }} className={KEY} disabled={disabled} aria-label="Apagar" onClick={onBackspace}>
        <Backspace size={26} aria-hidden />
      </motion.button>
    </div>
  );
}

/** 12345678901 → 123.456.789-01 (parcial enquanto digita). */
export function maskCpf(digits: string): string {
  const d = digits.slice(0, 11);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 9);
  const e = d.slice(9, 11);
  return [a, b && `.${b}`, c && `.${c}`, e && `-${e}`].join('');
}

export const onlyDigits = (v: string) => v.replace(/\D/g, '');
