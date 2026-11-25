'use client';
/**
 * [SEM DESIGN] Cadastro e edição de totem em painel lateral (padrão dos Atestados). Em edição, também as ações
 * Regenerar chave, Desativar/Reativar e Excluir. A chave nova sai por `onKey` (estado do pai), nunca daqui.
 */
import { ArrowsClockwise, Power, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SelectField, SwitchField, TextInput } from '@/components/ui/Fields';
import { SidePanel } from '@/components/ui/SidePanel';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { notify } from '@/components/ui/notify';
import type { Device, EntityId } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { useCreateDevice, useRegenerateKey, useRemoveDevice, useUpdateDevice, type KeyReveal } from './hooks';
import { deviceFormSchema } from './schemas';

export interface DeviceFormPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem `device`: cadastro. Com `device`: edição. */
  device?: Device;
  onKey: (reveal: KeyReveal) => void;
  /** Depois de excluir (a tela de detalhe volta para a lista). */
  onDeleted?: () => void;
}

export function DeviceFormPanel(props: DeviceFormPanelProps) {
  const { open, onOpenChange, device } = props;
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      title={device ? COPY.form.editTitle : COPY.form.createTitle}
      description={device ? device.name : COPY.form.createText}
    >
      {open && <FormBody {...props} />}
    </SidePanel>
  );
}

type Dialog = 'regenerate' | 'deactivate' | 'delete' | null;

function FormBody({ onOpenChange, device, onKey, onDeleted }: DeviceFormPanelProps) {
  const { establishments, establishment } = useSession();
  const options = establishments.filter((e) => e.id !== '').map((e) => ({ value: e.id, label: e.name }));
  const [dialog, setDialog] = useState<Dialog>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useZodForm(deviceFormSchema, {
    name: device?.name ?? '',
    establishmentId: device?.establishmentId ?? (establishment.id || options[0]?.value || ''),
    isActive: device?.isActive ?? true,
  });
  const create = useCreateDevice((reveal) => onKey(reveal));
  const update = useUpdateDevice();
  const regenerate = useRegenerateKey((reveal) => onKey(reveal));
  const remove = useRemoveDevice();
  const errors = form.formState.errors;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (device) {
        await update.mutateAsync({ id: device.id, body: { name: values.name } });
        notify.success(COPY.form.saved);
      } else {
        await create.mutateAsync({ establishmentId: values.establishmentId, name: values.name });
        notify.success(COPY.form.created);
      }
      onOpenChange(false);
    } catch (e) {
      const err = asApiError(e);
      // Nome repetido no estabelecimento: erro no campo, sem fechar o painel.
      if (err.code === 'APARELHO_NOME_DUPLICADO') {
        form.setError('name', { type: 'server', message: err.message });
        form.setFocus('name');
      } else setFormError(applyApiErrors(form, err));
    }
  });

  const setActive = async (id: EntityId, isActive: boolean) => {
    await update.mutateAsync({ id, body: { isActive } });
    notify.success(isActive ? COPY.actions.reactivated : COPY.actions.deactivated);
    onOpenChange(false);
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      <TextInput label={COPY.form.name} hint={COPY.form.nameHint} required autoComplete="off" error={errors.name?.message} {...form.register('name')} />
      {device ? (
        <TextInput label={COPY.form.establishment} readOnly value={options.find((o) => o.value === device.establishmentId)?.label ?? ''} />
      ) : (
        <SelectField
          label={COPY.form.establishment}
          required
          value={form.watch('establishmentId')}
          onValueChange={(v) => form.setValue('establishmentId', v, { shouldValidate: true })}
          options={options}
          error={errors.establishmentId?.message}
        />
      )}
      {!device && <SwitchField label={COPY.form.active} checked disabled onCheckedChange={() => undefined} />}
      {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>{COPY.form.cancel}</Button>
        <Button type="submit" loading={create.isPending || update.isPending}>{device ? COPY.form.save : COPY.form.create}</Button>
      </div>

      {device && (
        <section aria-label={COPY.actions.title} className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 className="m-0 text-sm font-bold">{COPY.actions.title}</h3>
          <Button variant="secondary" icon={<ArrowsClockwise size={18} aria-hidden />} onClick={() => setDialog('regenerate')}>{COPY.actions.regenerate}</Button>
          {device.isActive ? (
            <Button variant="secondary" icon={<Power size={18} aria-hidden />} onClick={() => setDialog('deactivate')}>{COPY.actions.deactivate}</Button>
          ) : (
            <Button variant="secondary" icon={<Power size={18} aria-hidden />} loading={update.isPending} onClick={() => void setActive(device.id, true).catch((e) => notify.error(asApiError(e)))}>{COPY.actions.reactivate}</Button>
          )}
          <Button variant="danger" disabled={device.hasPunches} icon={<Trash size={18} aria-hidden />} onClick={() => setDialog('delete')}>{COPY.actions.delete}</Button>
          {device.hasPunches && <p className="m-0 text-xs text-muted">{COPY.actions.deleteBlocked}</p>}

          <ConfirmDialog
            open={dialog === 'regenerate'}
            onOpenChange={(o) => setDialog(o ? 'regenerate' : null)}
            tone="danger"
            title={COPY.actions.regenerateTitle}
            description={COPY.actions.regenerateText}
            confirmLabel={COPY.actions.regenerateConfirm}
            onConfirm={async () => {
              await regenerate.mutateAsync(device.id);
              // A chave nova aparece no modal do pai; o painel sai da frente.
              onOpenChange(false);
            }}
          />
          <ConfirmDialog
            open={dialog === 'deactivate'}
            onOpenChange={(o) => setDialog(o ? 'deactivate' : null)}
            title={COPY.actions.deactivateTitle}
            description={COPY.actions.deactivateText}
            confirmLabel={COPY.actions.deactivateConfirm}
            onConfirm={() => setActive(device.id, false)}
          />
          <ConfirmDialog
            open={dialog === 'delete'}
            onOpenChange={(o) => setDialog(o ? 'delete' : null)}
            tone="danger"
            title={COPY.actions.deleteTitle}
            description={COPY.actions.deleteText}
            confirmLabel={COPY.actions.deleteConfirm}
            typeToConfirm={device.name}
            onConfirm={async () => {
              await remove.mutateAsync(device.id);
              notify.success(COPY.actions.deleted);
              onOpenChange(false);
              onDeleted?.();
            }}
          />
        </section>
      )}
    </form>
  );
}
