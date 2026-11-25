'use client';
import { CalendarBlank } from '@phosphor-icons/react';
import { useState } from 'react';
import { useClock } from '@/lib/clock-context';
import { addCivilDays, addMonths, formatPeriod, monthOf, monthRange, todayCivil } from '@/lib/format';
import { Button } from './Button';
import { DateInput } from './Fields';
import { Popover, PopoverContent, PopoverTrigger } from './shadcn/popover';

export interface Period {
  /** AAAA-MM-DD */
  from: string;
  /** AAAA-MM-DD */
  to: string;
}

export interface PeriodPreset {
  id: string;
  label: string;
  /** `today` é a data civil de hoje (pelo Clock). */
  range: (today: string) => Period;
}

/** Este mês = do dia 1 até hoje [A CONFIRMAR com o design: mês inteiro ou até hoje]. */
export const DEFAULT_PERIOD_PRESETS: PeriodPreset[] = [
  { id: 'this-month', label: 'Este mês', range: (t) => ({ from: `${monthOf(t)}-01`, to: t }) },
  { id: 'last-month', label: 'Mês anterior', range: (t) => monthRange(addMonths(monthOf(t), -1)) },
  { id: 'last-7-days', label: 'Últimos 7 dias', range: (t) => ({ from: addCivilDays(t, -6), to: t }) },
];

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export function PeriodPicker({ value, onChange, presets = DEFAULT_PERIOD_PRESETS, label = 'Período' }: {
  value: Period;
  onChange: (value: Period) => void;
  presets?: PeriodPreset[];
  label?: string;
}) {
  const clock = useClock();
  const today = todayCivil(clock);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<Period>(value);
  const invalid = !CIVIL.test(custom.from) || !CIVIL.test(custom.to) || custom.from > custom.to;

  const pick = (p: Period) => {
    onChange(p);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setCustom(value); }}>
      <PopoverTrigger asChild>
        <Button variant="secondary" aria-label={`${label}: ${formatPeriod(value.from, value.to)}`} icon={<CalendarBlank size={18} aria-hidden />}>
          {formatPeriod(value.from, value.to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`Escolher ${label.toLowerCase()}`} className="flex w-72 flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <Button key={p.id} variant="ghost" className="justify-start" onClick={() => pick(p.range(today))}>{p.label}</Button>
          ))}
        </div>
        <fieldset className="flex flex-col gap-2 border-t border-line pt-3">
          <legend className="mb-1 text-xs font-semibold text-muted">Personalizado</legend>
          <DateInput label="De" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
          <DateInput
            label="Até"
            value={custom.to}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            error={CIVIL.test(custom.from) && CIVIL.test(custom.to) && custom.from > custom.to ? 'A data final vem antes da inicial.' : undefined}
          />
          <Button disabled={invalid} onClick={() => pick(custom)}>Aplicar</Button>
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}
