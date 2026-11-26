'use client';
/**
 * Cadastro de empresa (conta + empresa + estabelecimento + convite do administrador). O token do link volta uma
 * vez: quem chama recebe pelo `onCreated` e o guarda só em estado de tela; nunca em cache, storage ou log.
 */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { SelectField, TextInput } from '@/components/ui/Fields';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { CreatedTenant } from '@/lib/api/super-admin-contracts';
import { onlyDigits } from '@/lib/cnpj';
import { maskCpf } from '@/lib/cpf';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { friendlyError } from './parts';
import { CnpjInput, MunicipalityField, RegistrationInput, UfField, useLegalNameFromCnpj } from './registration-fields';
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
    name: '', legalName: '', cnpj: '', establishmentName: '', registrationType: 'CNPJ', registration: '', uf: '', municipalityIbge: '', adminName: '', adminEmail: '', adminCpf: '',
  });
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors, isSubmitting, isSubmitted } } = form;
  const [formError, setFormError] = useState<string | null>(null);
  const registrationType = watch('registrationType');
  const uf = watch('uf');
  // Depois da primeira tentativa de envio, o campo revalida a cada mudança.
  const revalidate = { shouldValidate: isSubmitted };
  const lookupHint = useLegalNameFromCnpj({
    cnpj: watch('cnpj'),
    getLegalName: () => getValues('legalName'),
    onFound: (legalName) => setValue('legalName', legalName, revalidate),
  });

  const submit = async (v: CreateTenantValues) => {
    setFormError(null);
    const cnpj = onlyDigits(v.cnpj);
    try {
      // Chamada direta (sem useMutation): o token do convite não passa por nenhum cache.
      const created = await api.superAdmin.tenants.create({
        name: v.name,
        company: { legalName: v.legalName, cnpj },
        establishment: {
          name: v.establishmentName, registrationType: v.registrationType,
          // Com CNPJ, o primeiro estabelecimento é a matriz: usa o CNPJ da empresa.
          registration: v.registrationType === 'CNPJ' ? cnpj : onlyDigits(v.registration),
          uf: v.uf, municipalityIbge: v.municipalityIbge,
        },
        admin: { name: v.adminName, email: v.adminEmail, cpf: onlyDigits(v.adminCpf) },
      });
      onCreated(created);
      onClose();
    } catch (e) {
      const err = friendlyError(e);
      if (err.code === 'CPF_INVALIDO') form.setError('adminCpf', { type: 'server', message: err.message }, { shouldFocus: true });
      else setFormError(applyApiErrors(form, err));
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
          <Controller
            control={control}
            name="cnpj"
            render={({ field }) => (
              <CnpjInput label={c.fields.cnpj} required hint={lookupHint} error={errors.cnpj?.message} name={field.name} ref={field.ref} onBlur={field.onBlur} value={field.value} onValueChange={field.onChange} />
            )}
          />
          <TextInput label={c.fields.legalName} required error={errors.legalName?.message} {...register('legalName')} />
        </fieldset>
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold">{c.sections.establishment}</legend>
          <TextInput className="sm:col-span-2" label={c.fields.establishmentName} required error={errors.establishmentName?.message} {...register('establishmentName')} />
          <SelectField
            label={c.fields.registrationType}
            required
            value={registrationType}
            onValueChange={(v) => {
              setValue('registration', '');
              setValue('registrationType', v as CreateTenantValues['registrationType'], revalidate);
            }}
            options={REGISTRATION_TYPES}
          />
          {registrationType !== 'CNPJ' && (
            <Controller
              control={control}
              name="registration"
              render={({ field }) => <RegistrationInput type={registrationType} error={errors.registration?.message} value={field.value} onValueChange={field.onChange} />}
            />
          )}
          <UfField
            value={uf}
            error={errors.uf?.message}
            onValueChange={(v) => {
              setValue('municipalityIbge', '');
              setValue('uf', v, revalidate);
            }}
          />
          <Controller
            control={control}
            name="municipalityIbge"
            render={({ field }) => <MunicipalityField uf={uf} error={errors.municipalityIbge?.message} value={field.value} onValueChange={field.onChange} />}
          />
        </fieldset>
        <fieldset className="m-0 grid gap-3 border-0 p-0 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-bold">{c.sections.admin}</legend>
          <TextInput label={c.fields.adminName} required autoComplete="off" error={errors.adminName?.message} {...register('adminName')} />
          <TextInput label={c.fields.adminEmail} required type="email" autoComplete="off" error={errors.adminEmail?.message} {...register('adminEmail')} />
          <Controller
            control={control}
            name="adminCpf"
            render={({ field }) => (
              <TextInput
                label={c.fields.adminCpf} required hint={c.fields.adminCpfHint} inputMode="numeric" autoComplete="off" placeholder="000.000.000-00"
                error={errors.adminCpf?.message} name={field.name} ref={field.ref} onBlur={field.onBlur}
                value={field.value} onChange={(e) => field.onChange(maskCpf(e.target.value))}
              />
            )}
          />
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
