'use client';
/**
 * Formulário de convite. Chamada direta à api (sem useMutation): o CPF e o token não passam por nenhum cache.
 * Quem abre recebe o resultado em `onCreated` e guarda o token só em estado de tela.
 */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { SelectField, TextInput } from '@/components/ui/Fields';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { EntityId } from '@/lib/api/contracts';
import { INVITE_ROLES, type CreatedInvite } from '@/lib/api/organization-contracts';
import { digitsOf, maskCpf } from '@/lib/cpf';
import { ROLE_LABEL } from '@/lib/labels';
import { useInvalidate } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { COPY, inviteError } from './copy';
import { inviteSchema, type InviteValues } from './schemas';

const ROLE_OPTIONS = INVITE_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export function InviteDialog({ tenantId, open, onOpenChange, onCreated }: {
  tenantId: EntityId | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (created: CreatedInvite) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <FormBody tenantId={tenantId} onClose={() => onOpenChange(false)} onCreated={onCreated} />}
    </Dialog>
  );
}

function FormBody({ tenantId, onClose, onCreated }: { tenantId: EntityId | null; onClose: () => void; onCreated: (created: CreatedInvite) => void }) {
  const { api } = useSession();
  const invalidate = useInvalidate();
  const c = COPY.form;
  const form = useZodForm(inviteSchema, { name: '', email: '', role: 'rh', cpf: '' });
  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = form;
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (v: InviteValues) => {
    setFormError(null);
    try {
      const created = await api.invites.create(tenantId, { name: v.name, email: v.email, role: v.role, cpf: digitsOf(v.cpf) });
      void invalidate('invites');
      onCreated(created);
      onClose();
    } catch (e) {
      const err = inviteError(e);
      if (err.code === 'EMAIL_IN_USE') form.setError('email', { type: 'server', message: err.message }, { shouldFocus: true });
      else if (err.code === 'CPF_INVALIDO') form.setError('cpf', { type: 'server', message: err.message }, { shouldFocus: true });
      else setFormError(applyApiErrors(form, err));
    }
  };

  return (
    <DialogContent className="max-h-[90vh] gap-4 overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">{c.title}</DialogTitle>
        <DialogDescription>{c.description}</DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={handleSubmit(submit)} className="flex flex-col gap-4">
        <TextInput label={c.name} required autoComplete="off" error={errors.name?.message} {...register('name')} />
        <TextInput label={c.email} required type="email" autoComplete="off" error={errors.email?.message} {...register('email')} />
        <Controller
          control={control}
          name="role"
          render={({ field }) => (
            <SelectField label={c.role} required value={field.value} onValueChange={field.onChange} options={ROLE_OPTIONS} error={errors.role?.message} />
          )}
        />
        <Controller
          control={control}
          name="cpf"
          render={({ field }) => (
            <TextInput
              label={c.cpf} required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" hint={c.cpfHint}
              error={errors.cpf?.message}
              name={field.name} ref={field.ref} onBlur={field.onBlur}
              value={field.value}
              onChange={(e) => field.onChange(maskCpf(e.target.value))}
            />
          )}
        />
        {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" disabled={isSubmitting} onClick={onClose}>{c.cancel}</Button>
          <Button type="submit" loading={isSubmitting}>{c.submit}</Button>
        </div>
      </form>
    </DialogContent>
  );
}
