'use client';
/** [SEM DESIGN] "Novo ajuste" lançado pelo RH: painel lateral com formulário. */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { DateInput, SelectField, TextArea, TimeInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { SidePanel } from '@/components/ui/SidePanel';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { ADJUSTMENT_TYPES, type CreateAdjustmentBody } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { ADJUSTMENT_TYPE } from '@/lib/labels';
import { useApiMutation } from '@/lib/query/hooks';
import { FormAlert, remapFields } from './parts';
import { createAdjustmentSchema, proposedAtOf } from './schemas';
import { useEmployeeOptions } from './useEmployeeOptions';

const FORM_ID = 'adjustment-create-form';
const TYPE_OPTIONS = ADJUSTMENT_TYPES.map((t) => ({ value: t, label: ADJUSTMENT_TYPE[t].label }));

export function AdjustmentFormPanel({ open, onOpenChange, defaults }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults: { employeeId: string; date: string };
}) {
  // Remonta a cada abertura: o formulário nasce zerado (ou com os valores do atalho).
  return open ? <Panel onOpenChange={onOpenChange} defaults={defaults} /> : null;
}

function Panel({ onOpenChange, defaults }: { onOpenChange: (open: boolean) => void; defaults: { employeeId: string; date: string } }) {
  const form = useZodForm(createAdjustmentSchema, { employeeId: defaults.employeeId, date: defaults.date, type: 'inclusao_batida', time: '', reason: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const employees = useEmployeeOptions();
  const create = useApiMutation((api, v: { employeeId: string; body: CreateAdjustmentBody }) => api.adjustments.create(v.employeeId, v.body), {
    invalidates: ['adjustments'],
  });
  const { errors } = form.formState;
  const type = form.watch('type');

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await create.mutateAsync({
        employeeId: v.employeeId,
        body: {
          date: v.date,
          type: v.type,
          reason: v.reason,
          ...(v.type === 'inclusao_batida' ? { proposedAt: proposedAtOf(v.date, v.time) } : {}),
        },
      });
      notify.success('Ajuste registrado', 'Ele fica pendente até a decisão. A marcação original não muda.');
      onOpenChange(false);
    } catch (e) {
      const err = asApiError(e);
      setFormError(applyApiErrors(form, remapFields(err, { proposedAt: 'time' })));
    }
  });

  return (
    <SidePanel
      open
      onOpenChange={onOpenChange}
      title="Novo ajuste"
      description="O ajuste acrescenta informação ao dia. A marcação original nunca é alterada nem apagada."
      footer={(
        <>
          <Button variant="secondary" disabled={create.isPending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form={FORM_ID} loading={create.isPending}>Registrar ajuste</Button>
        </>
      )}
    >
      <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <Controller
          control={form.control}
          name="employeeId"
          render={({ field }) => (
            <SelectField
              label="Colaborador"
              required
              value={field.value}
              onValueChange={field.onChange}
              options={employees.options}
              placeholder={employees.isPending ? 'Carregando…' : 'Selecione'}
              error={errors.employeeId?.message}
            />
          )}
        />
        <DateInput label="Dia" required error={errors.date?.message} {...form.register('date')} />
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <SelectField label="Tipo" required value={field.value} onValueChange={field.onChange} options={TYPE_OPTIONS} error={errors.type?.message} />
          )}
        />
        {type === 'inclusao_batida' && (
          <TimeInput label="Horário da marcação proposta" required hint="Horário local do estabelecimento." error={errors.time?.message} {...form.register('time')} />
        )}
        <TextArea label="Motivo" required rows={3} maxLength={500} hint="De 3 a 500 caracteres." error={errors.reason?.message} {...form.register('reason')} />
        {formError && <FormAlert>{formError}</FormAlert>}
      </form>
    </SidePanel>
  );
}
