'use client';
/** Criar e editar empresa e estabelecimento de uma conta (super_admin). */
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { SelectField, TextInput } from '@/components/ui/Fields';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { EntityId } from '@/lib/api/contracts';
import { REGISTRATION_TYPES, type Company, type CompanyEstablishment } from '@/lib/api/organization-contracts';
import { formatCnpj } from '@/lib/cnpj';
import { COPY } from './copy';
import { useSaveCompany, useSaveEstablishment } from './hooks';
import { companyInput, companyPatch, companySchema, establishmentInput, establishmentPatch, establishmentSchema, type CompanyValues, type EstablishmentValues } from './organization-rules';
import { friendlyError } from './parts';

const c = COPY.organization;
const TYPE_OPTIONS = REGISTRATION_TYPES.map((t) => ({ value: t, label: t }));

function Shell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
    </DialogContent>
  );
}

function Actions({ error, pending, submitLabel, onCancel }: { error: string | null; pending: boolean; submitLabel: string; onCancel: () => void }) {
  return (
    <>
      {error && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={pending} onClick={onCancel}>{c.cancel}</Button>
        <Button type="submit" loading={pending}>{submitLabel}</Button>
      </div>
    </>
  );
}

/** `company` null: nova empresa. */
export interface CompanyTarget {
  company: Company | null;
}

export function CompanyDialog({ tenantId, target, onClose }: { tenantId: EntityId; target: CompanyTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {target && <CompanyForm tenantId={tenantId} company={target.company} onClose={onClose} />}
    </Dialog>
  );
}

function CompanyForm({ tenantId, company, onClose }: { tenantId: EntityId; company: Company | null; onClose: () => void }) {
  const save = useSaveCompany();
  const form = useZodForm(companySchema, { legalName: company?.legalName ?? '', cnpj: company ? formatCnpj(company.cnpj) : '' });
  const { register, handleSubmit, formState: { errors } } = form;
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (v: CompanyValues) => {
    setFormError(null);
    try {
      if (!company) await save.mutateAsync({ tenantId, create: companyInput(v) });
      else {
        const patch = companyPatch(company, v);
        if (Object.keys(patch).length > 0) await save.mutateAsync({ tenantId, id: company.id, patch });
      }
      onClose();
    } catch (e) {
      const err = friendlyError(e);
      if (err.code === 'CNPJ_INVALIDO' || err.code === 'CNPJ_DUPLICADO') form.setError('cnpj', { type: 'server', message: err.message }, { shouldFocus: true });
      else setFormError(applyApiErrors(form, err));
    }
  };

  return (
    <Shell title={company ? c.editCompany : c.newCompany} description={company ? company.legalName : c.newCompanyHint}>
      <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
        <TextInput label={COPY.create.fields.legalName} required autoComplete="off" error={errors.legalName?.message} {...register('legalName')} />
        <TextInput label={COPY.create.fields.cnpj} required inputMode="numeric" autoComplete="off" error={errors.cnpj?.message} {...register('cnpj')} />
        <Actions error={formError} pending={save.isPending} submitLabel={company ? c.save : c.createCompany} onCancel={onClose} />
      </form>
    </Shell>
  );
}

/** `establishment` null: novo estabelecimento da empresa. */
export interface EstablishmentTarget {
  company: Company;
  establishment: CompanyEstablishment | null;
}

export function EstablishmentDialog({ tenantId, target, onClose }: { tenantId: EntityId; target: EstablishmentTarget | null; onClose: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      {target && <EstablishmentForm tenantId={tenantId} {...target} onClose={onClose} />}
    </Dialog>
  );
}

function EstablishmentForm({ tenantId, company, establishment, onClose }: EstablishmentTarget & { tenantId: EntityId; onClose: () => void }) {
  const save = useSaveEstablishment();
  const form = useZodForm(establishmentSchema, {
    name: establishment?.name ?? '',
    registrationType: establishment?.registrationType ?? 'CNPJ',
    registration: establishment?.registration ?? '',
    uf: establishment?.uf ?? '',
    municipalityIbge: establishment?.municipalityIbge ?? '',
  });
  const { register, handleSubmit, setValue, watch, formState: { errors } } = form;
  const [formError, setFormError] = useState<string | null>(null);
  const registrationType = watch('registrationType');
  const f = COPY.create.fields;

  const submit = async (v: EstablishmentValues) => {
    setFormError(null);
    try {
      if (!establishment) await save.mutateAsync({ tenantId, companyId: company.id, create: establishmentInput(v, company.cnpj) });
      else {
        const patch = establishmentPatch(establishment, v, company.cnpj);
        if (Object.keys(patch).length > 0) await save.mutateAsync({ tenantId, id: establishment.id, patch });
      }
      onClose();
    } catch (e) {
      const err = friendlyError(e);
      if (err.code === 'INSCRICAO_DUPLICADA') form.setError('registration', { type: 'server', message: err.message }, { shouldFocus: true });
      else setFormError(applyApiErrors(form, err));
    }
  };

  return (
    <Shell title={establishment ? c.editEstablishment : c.newEstablishment} description={company.legalName}>
      <form noValidate onSubmit={handleSubmit(submit)} className="grid gap-4 sm:grid-cols-2">
        <TextInput label={f.establishmentName} required autoComplete="off" error={errors.name?.message} {...register('name')} />
        <SelectField
          label={f.registrationType}
          required
          value={registrationType}
          onValueChange={(v) => setValue('registrationType', v as EstablishmentValues['registrationType'], { shouldValidate: true })}
          options={TYPE_OPTIONS}
        />
        <TextInput label={f.registration} hint={registrationType === 'CNPJ' ? f.registrationHint : undefined} inputMode="numeric" autoComplete="off" error={errors.registration?.message} {...register('registration')} />
        <TextInput label={f.uf} required maxLength={2} autoComplete="off" error={errors.uf?.message} {...register('uf')} />
        <TextInput label={f.municipalityIbge} required inputMode="numeric" maxLength={7} autoComplete="off" error={errors.municipalityIbge?.message} {...register('municipalityIbge')} />
        <div className="flex flex-col gap-4 sm:col-span-2">
          <Actions error={formError} pending={save.isPending} submitLabel={establishment ? c.save : c.createEstablishment} onCancel={onClose} />
        </div>
      </form>
    </Shell>
  );
}
