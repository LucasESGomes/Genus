'use client';
/**
 * Afastamentos do colaborador, dentro do espelho (mapa §4.9). Mostra "afastado de D1 a D2" e o TIPO.
 * Nunca diagnóstico: o contrato não tem CID e o afastamento por atestado aparece só como "Atestado".
 */
import { Plus, UserMinus } from '@phosphor-icons/react';
import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput, SelectField } from '@/components/ui/Fields';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { Skeleton } from '@/components/ui/States';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { notify } from '@/components/ui/notify';
import { MANUAL_ABSENCE_TYPES, type Absence, type EntityId } from '@/lib/api/contracts';
import { can } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { MANUAL_ABSENCE_TYPE } from '@/lib/labels';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { ABSENCE_COPY, absenceTypeLabel } from './copy';

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** `atestado` não é tipo manual: nasce da aprovação do atestado (por isso o enum vem de MANUAL_ABSENCE_TYPES). */
export const createAbsenceSchema = z
  .object({
    type: z.string().min(1, ABSENCE_COPY.pickType).pipe(z.enum(MANUAL_ABSENCE_TYPES, { error: ABSENCE_COPY.pickType })),
    startDate: z.string().regex(CIVIL, ABSENCE_COPY.dateRequired),
    endDate: z.string().regex(CIVIL, ABSENCE_COPY.dateRequired),
  })
  .refine((b) => !CIVIL.test(b.startDate) || !CIVIL.test(b.endDate) || b.endDate >= b.startDate, { path: ['endDate'], message: ABSENCE_COPY.endBeforeStart });

const TYPE_OPTIONS = MANUAL_ABSENCE_TYPES.map((t) => ({ value: t, label: MANUAL_ABSENCE_TYPE[t].label }));

export function AbsencesSection({ employeeId }: { employeeId: EntityId }) {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const allowed = can(me.role, 'absence.view');
  const q = useApiQuery('absences', { employeeId }, (api, signal) => api.absences.list(employeeId, signal), { enabled: allowed });
  if (!allowed) return null;

  return (
    <Card as="section" className="flex flex-col gap-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{ABSENCE_COPY.title}</h2>
        {can(me.role, 'absence.create') && (
          <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={() => setOpen(true)}>{ABSENCE_COPY.register}</Button>
        )}
      </div>
      <QueryView
        query={q}
        what="os afastamentos"
        loading={<div aria-busy="true" aria-label="Carregando afastamentos"><Skeleton className="h-4 w-[60%]" /></div>}
        isEmpty={(d) => d.length === 0}
        empty={
          <p className="m-0 flex items-center gap-2 text-sm text-muted">
            <UserMinus size={18} aria-hidden />
            {ABSENCE_COPY.none}
          </p>
        }
      >
        {(list) => (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {list.map((a) => <AbsenceItem key={a.id} absence={a} />)}
          </ul>
        )}
      </QueryView>
      {can(me.role, 'absence.create') && <AbsencePanel employeeId={employeeId} open={open} onOpenChange={setOpen} />}
    </Card>
  );
}

function AbsenceItem({ absence: a }: { absence: Absence }) {
  const range = a.startDate === a.endDate ? `no dia ${formatDate(a.startDate)}` : `de ${formatDate(a.startDate)} a ${formatDate(a.endDate)}`;
  return (
    <li className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="font-semibold">Afastado {range}</span>
      <span className="text-muted">· {absenceTypeLabel(a.type)}</span>
    </li>
  );
}

function AbsencePanel({ employeeId, open, onOpenChange }: { employeeId: EntityId; open: boolean; onOpenChange: (o: boolean) => void }) {
  // O formulário nasce zerado a cada abertura.
  return (
    <SidePanel open={open} onOpenChange={onOpenChange} title={ABSENCE_COPY.register} description={ABSENCE_COPY.panelHint}>
      {open && <AbsenceForm employeeId={employeeId} onDone={() => onOpenChange(false)} />}
    </SidePanel>
  );
}

function AbsenceForm({ employeeId, onDone }: { employeeId: EntityId; onDone: () => void }) {
  const form = useZodForm(createAbsenceSchema, { type: '', startDate: '', endDate: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const create = useApiMutation(
    (api, body: z.output<typeof createAbsenceSchema>) => api.absences.create(employeeId, body),
    {
      invalidates: ['absences', 'timesheets', 'day'],
      onSuccess: () => {
        notify.success(ABSENCE_COPY.saved, ABSENCE_COPY.savedHint);
        onDone();
      },
      onError: (e) => setFormError(applyApiErrors(form, e)),
    },
  );
  const { errors, isSubmitted } = form.formState;
  const set = (name: 'type' | 'startDate' | 'endDate', value: string) => form.setValue(name, value, { shouldValidate: isSubmitted, shouldDirty: true });
  const w = form.watch();

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        setFormError(null);
        void form.handleSubmit((v) => create.mutate(v))(e);
      }}
    >
      <SelectField label="Tipo" required value={w.type} onValueChange={(v) => set('type', v)} options={TYPE_OPTIONS} placeholder="Escolha o tipo" error={errors.type?.message} />
      <DateInput label="Primeiro dia" required value={w.startDate} onChange={(e) => set('startDate', e.target.value)} error={errors.startDate?.message} />
      <DateInput label="Último dia" required value={w.endDate} onChange={(e) => set('endDate', e.target.value)} error={errors.endDate?.message} />
      {formError && <p role="alert" className="m-0 text-sm font-medium text-danger">{formError}</p>}
      <p className="m-0 text-xs text-muted">{ABSENCE_COPY.certificateNote}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={create.isPending}>{ABSENCE_COPY.save}</Button>
      </div>
    </form>
  );
}
