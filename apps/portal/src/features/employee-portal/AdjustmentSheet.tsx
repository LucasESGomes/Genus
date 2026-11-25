'use client';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { DateInput, TextArea, TimeInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { asApiError } from '@/lib/api/errors';
import { useRequestAdjustment } from './hooks';
import { ChoiceGroup, FormAlert, PortalSheet, remapFields } from './parts';
import { adjustmentSchema, proposedAtOf, type AdjustmentForm } from './schemas';

const TYPE_OPTIONS = [
  { value: 'inclusao_batida', label: 'Faltou uma marcação', hint: 'Esqueci de bater o ponto ou ele não registrou.' },
  { value: 'justificativa', label: 'Quero justificar o dia', hint: 'Explico o que aconteceu naquele dia.' },
];

/** Pedido de ajuste de marcação. O RH decide; a marcação original nunca é alterada. */
export function AdjustmentSheet({ open, onOpenChange, defaultDate }: { open: boolean; onOpenChange: (open: boolean) => void; defaultDate: string }) {
  return (
    <PortalSheet open={open} onOpenChange={onOpenChange} title="Pedir ajuste de marcação" description="O RH vai analisar o pedido. Sua marcação original não é apagada.">
      {open && <AdjustmentForm defaultDate={defaultDate} onDone={() => onOpenChange(false)} />}
    </PortalSheet>
  );
}

const PERIOD_CLOSED_HINT = ' Fale com o RH da sua unidade.';

function AdjustmentForm({ defaultDate, onDone }: { defaultDate: string; onDone: () => void }) {
  const form = useZodForm(adjustmentSchema, { date: defaultDate, type: 'inclusao_batida', time: '', reason: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const request = useRequestAdjustment();
  const { errors } = form.formState;
  const type = form.watch('type');

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await request.mutateAsync({
        date: v.date,
        type: v.type,
        reason: v.reason,
        ...(v.type === 'inclusao_batida' ? { proposedAt: proposedAtOf(v.date, v.time) } : {}),
      });
      notify.success('Pedido enviado', 'O RH vai analisar e você vê a resposta aqui.');
      onDone();
    } catch (e) {
      const err = asApiError(e);
      const general = applyApiErrors(form, remapFields(err, { proposedAt: 'time' }));
      if (general) setFormError(err.code === 'PERIODO_FECHADO' ? `${general}${PERIOD_CLOSED_HINT}` : general);
    }
  });

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <DateInput label="Dia" required className="h-12" error={errors.date?.message} {...form.register('date')} />
      <Controller
        control={form.control}
        name="type"
        render={({ field }) => (
          <ChoiceGroup
            legend="O que aconteceu?"
            value={field.value}
            onValueChange={(v) => field.onChange(v)}
            options={TYPE_OPTIONS}
            error={errors.type?.message}
          />
        )}
      />
      {type === 'inclusao_batida' && (
        <TimeInput label="Horário da marcação" required className="h-12" error={errors.time?.message} {...form.register('time')} />
      )}
      <TextArea label="Motivo" required rows={3} maxLength={500} hint="Conte o que aconteceu, em poucas palavras." error={errors.reason?.message} {...form.register('reason')} />
      {formError && <FormAlert>{formError}</FormAlert>}
      <Button type="submit" loading={request.isPending} className="min-h-12 w-full text-base">Enviar pedido</Button>
      <Button variant="secondary" disabled={request.isPending} className="min-h-12 w-full" onClick={onDone}>Cancelar</Button>
    </form>
  );
}
