'use client';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { addMonths, formatMonth } from '@/lib/format';
import { Button } from './Button';

/** Navegação de mês: anterior, rótulo "novembro de 2026" e próximo. `value` é AAAA-MM. */
export function MonthPicker({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  return (
    <div role="group" aria-label="Mês" className="inline-flex items-center gap-1">
      <Button variant="secondary" size="sm" aria-label="Mês anterior" onClick={() => onChange(addMonths(value, -1))} icon={<CaretLeft size={14} aria-hidden />} />
      <span aria-live="polite" className="min-w-[150px] text-center text-sm font-semibold">{formatMonth(value)}</span>
      <Button variant="secondary" size="sm" aria-label="Próximo mês" onClick={() => onChange(addMonths(value, 1))} icon={<CaretRight size={14} aria-hidden />} />
    </div>
  );
}
