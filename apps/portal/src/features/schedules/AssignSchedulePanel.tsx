'use client';
/** Atribuir escala a um colaborador, com vigência (rh). A api recusa vigência sobreposta (409). */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { useEmployeeChoices } from '@/features/employees/hooks';
import { Button } from '@/components/ui/Button';
import { DateInput, SelectField } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { SidePanel } from '@/components/ui/SidePanel';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { Schedule } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { COPY } from './copy';
import { useAssignSchedule } from './hooks';

const FORM_ID = 'assign-schedule-form';

const schema = z
  .object({
    employeeId: z.string().min(1, 'Escolha o colaborador.'),
    scheduleId: z.string().min(1, 'Escolha a escala.'),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe o início da vigência.'),
    validTo: z.string(),
  })
  .refine((v) => v.validTo === '' || v.validTo >= v.validFrom, { path: ['validTo'], message: 'O fim não pode ser antes do início.' });

export function AssignSchedulePanel({ open, onOpenChange, schedules, defaultScheduleId }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedules: Schedule[];
  defaultScheduleId?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <SidePanel
      open={open}
      onOpenChange={(o) => { if (!pending) onOpenChange(o); }}
      title={COPY.assign}
      description="A escala vale a partir da data de início. Marcações já feitas não mudam."
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form={FORM_ID} loading={pending}>Atribuir</Button>
        </>
      )}
    >
      {open && <AssignForm schedules={schedules} defaultScheduleId={defaultScheduleId} onPending={setPending} onDone={() => onOpenChange(false)} />}
    </SidePanel>
  );
}

function AssignForm({ schedules, defaultScheduleId, onPending, onDone }: { schedules: Schedule[]; defaultScheduleId?: string; onPending: (v: boolean) => void; onDone: () => void }) {
  const form = useZodForm(schema, { employeeId: '', scheduleId: defaultScheduleId ?? '', validFrom: '', validTo: '' });
  const choices = useEmployeeChoices();
  const assign = useAssignSchedule();
  const [formError, setFormError] = useState<string | null>(null);
  const { errors } = form.formState;
  const employeeId = form.watch('employeeId');
  const employee = choices.employees.find((e) => e.id === employeeId);
  // A escala precisa ser do mesmo estabelecimento do colaborador.
  const options = schedules.filter((s) => !employee || s.establishmentId === employee.establishmentId).map((s) => ({ value: s.id, label: s.name }));

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    onPending(true);
    try {
      await assign.mutateAsync({ employeeId: v.employeeId, body: { scheduleId: v.scheduleId, validFrom: v.validFrom, validTo: v.validTo || null } });
      notify.success('Escala atribuída');
      onDone();
    } catch (e) {
      const err = asApiError(e);
      setFormError(err.code === 'ESCALA_SOBREPOSTA' ? 'Esta vigência se sobrepõe a outra escala do colaborador. Ajuste as datas.' : applyApiErrors(form, err));
    } finally {
      onPending(false);
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <Controller control={form.control} name="employeeId" render={({ field }) => (
        <SelectField
          label="Colaborador" required value={field.value} onValueChange={field.onChange} error={errors.employeeId?.message}
          options={choices.employees.filter((e) => e.status === 'ativo').map((e) => ({ value: e.id, label: e.registrationNumber ? `${e.name} · ${e.registrationNumber}` : e.name }))}
        />
      )} />
      <Controller control={form.control} name="scheduleId" render={({ field }) => (
        <SelectField label="Escala" required value={field.value} onValueChange={field.onChange} options={options} error={errors.scheduleId?.message} />
      )} />
      <DateInput label="Início da vigência" required error={errors.validFrom?.message} {...form.register('validFrom')} />
      <DateInput label="Fim da vigência" hint="Deixe vazio para vigência em aberto." error={errors.validTo?.message} {...form.register('validTo')} />
      {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
    </form>
  );
}
