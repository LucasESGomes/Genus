'use client';
import { Backspace } from '@phosphor-icons/react';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const KEY = 'flex h-16 cursor-pointer items-center justify-center rounded-lg border border-line-strong bg-white text-2xl font-bold hover:bg-surface active:bg-tint disabled:cursor-not-allowed disabled:opacity-50';

/** Teclado numérico grande. Quem usa guarda os dígitos só em memória. */
export function Keypad({ onDigit, onBackspace, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Teclado numérico" className="grid grid-cols-3 gap-2">
      {DIGITS.map((d) => (
        <button key={d} type="button" className={KEY} disabled={disabled} onClick={() => onDigit(d)}>{d}</button>
      ))}
      <span aria-hidden />
      <button type="button" className={KEY} disabled={disabled} onClick={() => onDigit('0')}>0</button>
      <button type="button" className={KEY} disabled={disabled} aria-label="Apagar" onClick={onBackspace}>
        <Backspace size={28} aria-hidden />
      </button>
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
