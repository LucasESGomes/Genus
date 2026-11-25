'use client';
/** Cadastro e edição de colaborador (rh) num painel lateral. CPF e estabelecimento não mudam depois do cadastro. */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { DateInput, SelectField, TextInput, type SelectOption } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { SidePanel } from '@/components/ui/SidePanel';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { Employee, EntityId } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { formatCpf } from '@/lib/format';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { useCreateEmployee, useEmployeeChoices, useUpdateEmployee } from './hooks';
import { createEmployeeSchema, digitsOf, editEmployeeSchema, maskCpf, NONE } from './schemas';

const FORM_ID = 'employee-form';

function managerOptions(employees: Employee[], selfId: EntityId | null, current: EntityId | null): SelectOption[] {
  const options = employees
    .filter((e) => e.id !== selfId && (e.status === 'ativo' || e.id === current))
    .map((e) => ({ value: e.id, label: e.registrationNumber ? `${e.name} · ${e.registrationNumber}` : e.name }));
  return [{ value: NONE, label: 'Sem gestor' }, ...options];
}

const FormAlert = ({ children }: { children: string }) => (
  <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{children}</p>
);

export function EmployeeFormPanel({ open, onOpenChange, employee, onCreated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem colaborador: cadastro. Com colaborador: edição. */
  employee: Employee | null;
  /** Só no cadastro: recebe o PIN inicial para mostrar uma vez. */
  onCreated: (created: { name: string; initialPin: string }) => void;
}) {
  const [pending, setPending] = useState(false);
  const editing = employee !== null;
  return (
    <SidePanel
      open={open}
      onOpenChange={(o) => { if (!pending) onOpenChange(o); }}
      title={editing ? 'Editar colaborador' : COPY.newEmployee}
      description={editing ? 'Nome, matrícula, nascimento e gestor.' : 'O PIN inicial aparece uma vez, depois do cadastro.'}
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form={FORM_ID} loading={pending}>{editing ? 'Salvar' : 'Cadastrar'}</Button>
        </>
      )}
    >
      {open && (employee
        ? <EditForm key={employee.id} employee={employee} onPending={setPending} onDone={() => onOpenChange(false)} />
        : <CreateForm onPending={setPending} onDone={() => onOpenChange(false)} onCreated={onCreated} />)}
    </SidePanel>
  );
}

function CreateForm({ onPending, onDone, onCreated }: { onPending: (v: boolean) => void; onDone: () => void; onCreated: (c: { name: string; initialPin: string }) => void }) {
  const { establishment, establishments } = useSession();
  const concrete = establishments.filter((e) => e.id !== '');
  const form = useZodForm(createEmployeeSchema, {
    establishmentId: establishment.id || concrete[0]?.id || '',
    cpf: '', name: '', registrationNumber: '', birthDate: '', admissionDate: '', managerId: NONE,
  });
  const choices = useEmployeeChoices();
  const create = useCreateEmployee();
  const [formError, setFormError] = useState<string | null>(null);
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    onPending(true);
    try {
      const created = await create.mutateAsync({
        establishmentId: v.establishmentId,
        cpf: digitsOf(v.cpf),
        name: v.name,
        ...(v.registrationNumber ? { registrationNumber: v.registrationNumber } : {}),
        birthDate: v.birthDate,
        admissionDate: v.admissionDate,
        managerId: v.managerId === NONE ? null : v.managerId,
      });
      // O PIN segue só para o diálogo; aqui nada fica guardado.
      onCreated({ name: created.name, initialPin: created.initialPin });
      onDone();
    } catch (e) {
      const err = asApiError(e);
      if (err.code === 'CPF_DUPLICADO') form.setError('cpf', { type: 'server', message: 'Já existe um colaborador com este CPF.' });
      else if (err.code === 'MATRICULA_DUPLICADA') form.setError('registrationNumber', { type: 'server', message: 'Já existe um colaborador com esta matrícula no estabelecimento.' });
      else setFormError(applyApiErrors(form, err));
    } finally {
      onPending(false);
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <Controller
        control={form.control}
        name="establishmentId"
        render={({ field }) => (
          <SelectField label="Estabelecimento" required value={field.value} onValueChange={field.onChange} options={concrete.map((e) => ({ value: e.id, label: e.name }))} error={errors.establishmentId?.message} />
        )}
      />
      <Controller
        control={form.control}
        name="cpf"
        render={({ field }) => (
          <TextInput
            label="CPF" required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00"
            hint="Só números. O CPF liga o colaborador às marcações e não muda depois."
            error={errors.cpf?.message}
            name={field.name} ref={field.ref} onBlur={field.onBlur}
            value={field.value}
            onChange={(e) => field.onChange(maskCpf(e.target.value))}
          />
        )}
      />
      <TextInput label="Nome completo" required autoComplete="off" error={errors.name?.message} {...form.register('name')} />
      <TextInput label="Matrícula" autoComplete="off" hint="Opcional. Única no estabelecimento." error={errors.registrationNumber?.message} {...form.register('registrationNumber')} />
      <DateInput label="Nascimento" required error={errors.birthDate?.message} {...form.register('birthDate')} />
      <DateInput label="Admissão" required error={errors.admissionDate?.message} {...form.register('admissionDate')} />
      <Controller
        control={form.control}
        name="managerId"
        render={({ field }) => (
          <SelectField label="Gestor" value={field.value} onValueChange={field.onChange} options={managerOptions(choices.employees, null, null)} hint="Opcional." error={errors.managerId?.message} />
        )}
      />
      {formError && <FormAlert>{formError}</FormAlert>}
    </form>
  );
}

function EditForm({ employee, onPending, onDone }: { employee: Employee; onPending: (v: boolean) => void; onDone: () => void }) {
  const { establishments } = useSession();
  const form = useZodForm(editEmployeeSchema, {
    name: employee.name,
    registrationNumber: employee.registrationNumber ?? '',
    birthDate: employee.birthDate ?? '',
    managerId: employee.managerId ?? NONE,
  });
  const choices = useEmployeeChoices();
  const update = useUpdateEmployee();
  const [formError, setFormError] = useState<string | null>(null);
  const { errors } = form.formState;
  const establishmentName = establishments.find((e) => e.id === employee.establishmentId)?.name ?? 'Estabelecimento do colaborador';

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    onPending(true);
    try {
      await update.mutateAsync({
        id: employee.id,
        body: { name: v.name, registrationNumber: v.registrationNumber || null, birthDate: v.birthDate, managerId: v.managerId === NONE ? null : v.managerId },
      });
      notify.success('Colaborador atualizado');
      onDone();
    } catch (e) {
      const err = asApiError(e);
      if (err.code === 'MATRICULA_DUPLICADA') form.setError('registrationNumber', { type: 'server', message: 'Já existe um colaborador com esta matrícula no estabelecimento.' });
      else setFormError(applyApiErrors(form, err));
    } finally {
      onPending(false);
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <TextInput label="Estabelecimento" readOnly value={establishmentName} hint={COPY.establishmentReadOnlyHint} />
      <TextInput label="CPF" readOnly value={formatCpf(employee.cpf)} hint={COPY.cpfReadOnlyHint} />
      <TextInput label="Nome completo" required autoComplete="off" error={errors.name?.message} {...form.register('name')} />
      <TextInput label="Matrícula" autoComplete="off" error={errors.registrationNumber?.message} {...form.register('registrationNumber')} />
      <DateInput label="Nascimento" required error={errors.birthDate?.message} {...form.register('birthDate')} />
      <Controller
        control={form.control}
        name="managerId"
        render={({ field }) => (
          <SelectField label="Gestor" value={field.value} onValueChange={field.onChange} options={managerOptions(choices.employees, employee.id, employee.managerId)} error={errors.managerId?.message} />
        )}
      />
      {formError && <FormAlert>{formError}</FormAlert>}
    </form>
  );
}
