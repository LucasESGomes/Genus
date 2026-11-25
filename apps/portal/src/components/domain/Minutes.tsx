import { describeMinutes, formatMinutes } from '@/lib/format';

const EMPHASIS = { none: '', warn: 'text-warn font-semibold', danger: 'text-danger font-semibold' } as const;

/** Minutos como "09:05"; o leitor de tela lê por extenso ("9 horas e 5 minutos"). O valor vem pronto da api. */
export function Minutes({ value, signed = false, emphasis = 'none' }: { value: number; signed?: boolean; emphasis?: keyof typeof EMPHASIS }) {
  const spoken = `${signed && value > 0 ? 'mais ' : ''}${describeMinutes(value)}`;
  return (
    <span className={`tabular-nums ${EMPHASIS[emphasis]}`}>
      <span aria-hidden>{formatMinutes(value, { signed })}</span>
      <span className="sr-only">{spoken}</span>
    </span>
  );
}
