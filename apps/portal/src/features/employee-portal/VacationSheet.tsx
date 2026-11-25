'use client';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { DateInput, TextInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { AccrualPeriod } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { plural } from '@/lib/format';
import { useRequestVacation } from './hooks';
import { ChoiceGroup, FormAlert, PortalSheet } from './parts';
import { vacationSchema } from './schemas';

/** Motivos de recusa (409) em linguagem simples. Os demais usam a mensagem da api, que já vem em pt-BR. */
const FRIENDLY: Record<string, string> = {
  FERIAS_SETOR_DESFALCADO: 'Muita gente do seu setor já está de férias nessas datas. Escolha outras datas ou fale com o RH.',
  FERIAS_SALDO_INSUFICIENTE: 'Você pediu mais dias do que tem disponíveis neste período.',
};

export const periodLabel = (p: Pick<AccrualPeriod, 'startDate' | 'endDate'>) =>
  `${p.startDate.slice(5, 7)}/${p.startDate.slice(0, 4)} a ${p.endDate.slice(5, 7)}/${p.endDate.slice(0, 4)}`;

export function VacationSheet({ open, onOpenChange, periods }: { open: boolean; onOpenChange: (open: boolean) => void; periods: AccrualPeriod[] }) {
  return (
    <PortalSheet open={open} onOpenChange={onOpenChange} title="Pedir férias" description="O pedido passa pelo RH. Se o setor estiver no limite, você recebe o motivo aqui.">
      {open && <VacationForm periods={periods} onDone={() => onOpenChange(false)} />}
    </PortalSheet>
  );
}

function VacationForm({ periods, onDone }: { periods: AccrualPeriod[]; onDone: () => void }) {
  const usable = periods.filter((p) => p.remainingDays > 0);
  const form = useZodForm(vacationSchema, { accrualPeriodId: usable[0]?.id ?? '', startDate: '', endDate: '', cashBonusDays: '0' });
  const [formError, setFormError] = useState<string | null>(null);
  const request = useRequestVacation();
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await request.mutateAsync({ accrualPeriodId: v.accrualPeriodId, startDate: v.startDate, endDate: v.endDate, cashBonusDays: Number(v.cashBonusDays) });
      notify.success('Pedido de férias enviado', 'O RH vai analisar e a resposta aparece aqui.');
      onDone();
    } catch (e) {
      const err = asApiError(e);
      const general = applyApiErrors(form, err);
      if (general) setFormError(FRIENDLY[err.code] ?? general);
    }
  });

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <Controller
        control={form.control}
        name="accrualPeriodId"
        render={({ field }) => (
          <ChoiceGroup
            legend="De qual período?"
            value={field.value}
            onValueChange={(v) => field.onChange(v)}
            options={usable.map((p) => ({ value: p.id, label: periodLabel(p), hint: `${plural(p.remainingDays, 'dia disponível', 'dias disponíveis')}` }))}
            error={errors.accrualPeriodId?.message}
          />
        )}
      />
      <DateInput label="Primeiro dia" required className="h-12" error={errors.startDate?.message} {...form.register('startDate')} />
      <DateInput label="Último dia" required className="h-12" error={errors.endDate?.message} {...form.register('endDate')} />
      <TextInput
        label="Dias de abono (opcional)"
        type="number"
        inputMode="numeric"
        min={0}
        max={10}
        className="h-12"
        hint="Quantos dias você quer vender, de 0 a 10."
        error={errors.cashBonusDays?.message}
        {...form.register('cashBonusDays')}
      />
      {formError && <FormAlert>{formError}</FormAlert>}
      <Button type="submit" loading={request.isPending} disabled={usable.length === 0} className="min-h-12 w-full text-base">Enviar pedido</Button>
      <Button variant="secondary" disabled={request.isPending} className="min-h-12 w-full" onClick={onDone}>Cancelar</Button>
    </form>
  );
}
