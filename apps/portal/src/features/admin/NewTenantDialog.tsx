'use client';
/**
 * Cadastro de empresa (conta + empresa + estabelecimento + administrador). A senha provisória volta uma vez:
 * quem chama recebe pelo `onCreated` e a guarda só em estado de tela; nunca em cache de consulta, storage ou log.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField, TextInput } from '@/components/ui/Fields';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { CreatedTenant } from '@/lib/api/super-admin-contracts';
import { onlyDigits } from '@/lib/cnpj';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { friendlyError } from './parts';
import { createTenantSchema, type CreateTenantValues } from './schemas';

const REGISTRATION_TYPES = [{ value: 'CNPJ', label: 'CNPJ' }, { value: 'CPF', label: 'CPF' }, { value: 'CAEPF', label: 'CAEPF' }];

export function NewTenantDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (created: CreatedTenant) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <FormBody onClose={() => onOpenChange(false)} onCreated={onCreated} />}
    </Dialog>
  );
}

function FormBody({ onClose, onCreated }: { onClose: () => void; onCreated: (created: CreatedTenant) => void }) {
  const { api } = useSession();
  const c = COPY.create;
  const form = useZodForm(createTenantSchema, {
    name: '', legalName: '', cnpj: '', establishmentName: '', registrationType: 'CNPJ', registration: '', uf: '', municipalityIbge: '', adminName: '', adminEmail: '',
  });
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = form;
  const [formError, setFormError] = useState<string | null>(null);
  const registrationType = watch('registrationType');

  const submit = async (v: CreateTenantValues) => {
    setFormError(null);
    const cnpj = onlyDigits(v.cnpj);
    try {
      // Chamada direta (sem useMutation): a senha provisória não passa por nenhum cache.
      const created = await api.superAdmin.tenants.create({
        name: v.name,
        company: { legalName: v.legalName, cnpj },
        establishment: {
          name: v.establishmentName, registrationType: v.registrationType,
          registration: onlyDigits(v.registration) || (v.registrationType === 'CNPJ' ? cnpj : ''),
          uf: v.uf, municipalityIbge: v.municipalityIbge,
        },
        admin: { name: v.adminName, email: v.adminEmail },
      });
      onCreated(created);
      onClose();
    } catch (e) {
      setFormError(applyApiErrors(form, friendlyError(e)));
    }
  };

  return (
    <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{c.title}</DialogTitle>
        <DialogDescription>{c.description}</DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-col gap-5">
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold">{c.sections.tenant}</legend>
          <TextInput className="sm:col-span-2" label={c.fields.name} required error={errors.name?.message} {...register('name')} />
        </fieldset>
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold">{c.sections.company}</legend>
          <TextInput label={c.fields.legalName} required error={errors.legalName?.message} {...register('legalName')} />
          <TextInput label={c.fields.cnpj} required inputMode="numeric" autoComplete="off" error={errors.cnpj?.message} {...register('cnpj')} />
        </fieldset>
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold">{c.sections.establishment}</legend>
          <TextInput className="sm:col-span-2" label={c.fields.establishmentName} required error={errors.establishmentName?.message} {...register('establishmentName')} />
          <SelectField
            label={c.fields.registrationType}
            required
            value={registrationType}
            onValueChange={(v) => setValue('registrationType', v as CreateTenantValues['registrationType'], { shouldValidate: true })}
            options={REGISTRATION_TYPES}
          />
          <TextInput label={c.fields.registration} hint={registrationType === 'CNPJ' ? c.fields.registrationHint : undefined} inputMode="numeric" autoComplete="off" error={errors.registration?.message} {...register('registration')} />
          <TextInput label={c.fields.uf} required maxLength={2} autoComplete="off" error={errors.uf?.message} {...register('uf')} />
          <TextInput label={c.fields.municipalityIbge} required inputMode="numeric" maxLength={7} autoComplete="off" error={errors.municipalityIbge?.message} {...register('municipalityIbge')} />
        </fieldset>
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold">{c.sections.admin}</legend>
          <TextInput label={c.fields.adminName} required autoComplete="off" error={errors.adminName?.message} {...register('adminName')} />
          <TextInput label={c.fields.adminEmail} required type="email" autoComplete="off" error={errors.adminEmail?.message} {...register('adminEmail')} />
        </fieldset>
        {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>{c.cancel}</Button>
          <Button type="submit" loading={isSubmitting}>{c.submit}</Button>
        </div>
      </form>
    </DialogContent>
  );
}
