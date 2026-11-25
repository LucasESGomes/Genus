'use client';
/**
 * Criar e editar escala (rh). Tipo e ciclo só na criação. Os avisos de jornada NUNCA bloqueiam o salvamento
 * (RN06, art. 74): quem decide é a api, que devolve os avisos junto com a escala salva.
 */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { CheckboxField, DateInput, SelectField, TextInput, TimeInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { SidePanel } from '@/components/ui/SidePanel';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { CYCLE_TYPES, SCHEDULE_TYPES, type Schedule } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { formatMinutes } from '@/lib/format';
import { CYCLE_TYPE, SCHEDULE_TYPE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { COPY } from './copy';
import { useCreateSchedule, useUpdateSchedule } from './hooks';
import { blankDay, buildDays, draftsOf, parseHours, scheduleSchema, type DayDraft } from './schemas';

const FORM_ID = 'schedule-form';

export function ScheduleFormPanel({ open, onOpenChange, schedule }: { open: boolean; onOpenChange: (open: boolean) => void; schedule: Schedule | null }) {
  const [pending, setPending] = useState(false);
  const editing = schedule !== null;
  return (
    <SidePanel
      open={open}
      onOpenChange={(o) => { if (!pending) onOpenChange(o); }}
      title={editing ? 'Editar escala' : COPY.newSchedule}
      description={COPY.warningsNote}
      width="lg"
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form={FORM_ID} loading={pending}>Salvar</Button>
        </>
      )}
    >
      {open && <ScheduleForm key={schedule?.id ?? 'new'} schedule={schedule} onPending={setPending} onDone={() => onOpenChange(false)} />}
    </SidePanel>
  );
}

function ScheduleForm({ schedule, onPending, onDone }: { schedule: Schedule | null; onPending: (v: boolean) => void; onDone: () => void }) {
  const { establishment, establishments } = useSession();
  const concrete = establishments.filter((e) => e.id !== '');
  const editing = schedule !== null;
  const form = useZodForm(scheduleSchema, {
    establishmentId: schedule?.establishmentId ?? (establishment.id || concrete[0]?.id || ''),
    name: schedule?.name ?? '',
    type: (schedule?.type as (typeof SCHEDULE_TYPES)[number] | undefined) ?? '5x2',
    cycleType: (schedule?.cycleType as (typeof CYCLE_TYPES)[number] | undefined) ?? 'semanal',
    cycleDays: schedule?.cycleDays ? String(schedule.cycleDays) : '',
    referenceDate: schedule?.referenceDate ?? '',
    weeklyHours: schedule ? formatMinutes(schedule.weeklyMinutes) : '',
  });
  const [drafts, setDrafts] = useState<Record<number, DayDraft>>(() => (schedule ? draftsOf(schedule) : {}));
  const [daysError, setDaysError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const { errors } = form.formState;

  const cycleType = form.watch('cycleType');
  const cycleDaysRaw = form.watch('cycleDays');
  const count = cycleType === 'semanal' ? 7 : Math.min(60, Math.max(0, Number.parseInt(cycleDaysRaw, 10) || 0));
  const patch = (p: number, change: Partial<DayDraft>) => setDrafts((d) => ({ ...d, [p]: { ...(d[p] ?? blankDay()), ...change } }));

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const built = buildDays(count, drafts);
    if ('error' in built) {
      setDaysError(built.error);
      return;
    }
    setDaysError(null);
    const weeklyMinutes = parseHours(v.weeklyHours) ?? 0;
    onPending(true);
    try {
      const saved = schedule
        ? await update.mutateAsync({ id: schedule.id, body: { name: v.name, weeklyMinutes, days: built.days } })
        : await create.mutateAsync({
          establishmentId: v.establishmentId, name: v.name, type: v.type, cycleType: v.cycleType,
          ...(v.cycleType === 'ciclico' ? { cycleDays: Number(v.cycleDays), referenceDate: v.referenceDate } : {}),
          weeklyMinutes, days: built.days,
        });
      // Avisos não impedem nada: a escala já foi salva; só informamos.
      notify.success('Escala salva', saved.warnings.length > 0 ? `Há ${saved.warnings.length} aviso(s) de jornada. Eles só sinalizam.` : undefined);
      onDone();
    } catch (e) {
      const err = asApiError(e);
      setFormError(applyApiErrors(form, err));
      if (err.fields.some((f) => f.path.startsWith('days'))) setDaysError(err.fields.find((f) => f.path.startsWith('days'))?.message ?? null);
    } finally {
      onPending(false);
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {!editing && (
        <Controller control={form.control} name="establishmentId" render={({ field }) => (
          <SelectField label="Estabelecimento" required value={field.value} onValueChange={field.onChange} options={concrete.map((e) => ({ value: e.id, label: e.name }))} error={errors.establishmentId?.message} />
        )} />
      )}
      <TextInput label="Nome da escala" required autoComplete="off" error={errors.name?.message} {...form.register('name')} />
      {editing ? (
        <>
          <TextInput label="Tipo" readOnly value={SCHEDULE_TYPE[schedule.type as keyof typeof SCHEDULE_TYPE]?.label ?? schedule.type} hint={COPY.readOnlyTypeHint} />
          <TextInput label="Ciclo" readOnly value={`${CYCLE_TYPE[schedule.cycleType as keyof typeof CYCLE_TYPE]?.label ?? schedule.cycleType}${schedule.cycleDays ? ` · ${schedule.cycleDays} dias` : ''}`} />
        </>
      ) : (
        <>
          <Controller control={form.control} name="type" render={({ field }) => (
            <SelectField label="Tipo" required value={field.value} onValueChange={field.onChange} options={SCHEDULE_TYPES.map((t) => ({ value: t, label: SCHEDULE_TYPE[t].label }))} error={errors.type?.message} />
          )} />
          <Controller control={form.control} name="cycleType" render={({ field }) => (
            <SelectField label="Ciclo" required value={field.value} onValueChange={field.onChange} options={CYCLE_TYPES.map((t) => ({ value: t, label: CYCLE_TYPE[t].label }))} error={errors.cycleType?.message} />
          )} />
          {cycleType === 'ciclico' && (
            <>
              <TextInput label="Dias do ciclo" required inputMode="numeric" hint="De 2 a 60." error={errors.cycleDays?.message} {...form.register('cycleDays')} />
              <DateInput label="Data de referência" required hint="Dia em que o ciclo começa na posição 1." error={errors.referenceDate?.message} {...form.register('referenceDate')} />
            </>
          )}
        </>
      )}
      <TextInput label="Carga semanal (HH:mm)" required placeholder="44:00" autoComplete="off" error={errors.weeklyHours?.message} {...form.register('weeklyHours')} />

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-1 text-sm font-semibold">Dias da escala</legend>
        {count === 0 && <p className="m-0 text-sm text-muted">Informe os dias do ciclo para montar a escala.</p>}
        {Array.from({ length: count }, (_, p) => {
          const d = drafts[p] ?? blankDay();
          return (
            <div key={p} role="group" aria-label={`Dia ${p + 1}`} className="flex flex-col gap-3 rounded-card border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Dia {p + 1}</span>
                <CheckboxField label={`Folga no dia ${p + 1}`} checked={d.isDayOff} onCheckedChange={(c) => patch(p, { isDayOff: c })} />
              </div>
              {!d.isDayOff && (
                <div className="grid grid-cols-2 gap-3">
                  <TimeInput label={`Entrada do dia ${p + 1}`} value={d.startTime} onChange={(e) => patch(p, { startTime: e.target.value })} />
                  <TimeInput label={`Saída do dia ${p + 1}`} value={d.endTime} onChange={(e) => patch(p, { endTime: e.target.value })} />
                  <TimeInput label={`Início do intervalo do dia ${p + 1}`} value={d.breakStartTime} onChange={(e) => patch(p, { breakStartTime: e.target.value })} />
                  <TimeInput label={`Fim do intervalo do dia ${p + 1}`} value={d.breakEndTime} onChange={(e) => patch(p, { breakEndTime: e.target.value })} />
                  <div className="col-span-2">
                    <CheckboxField label={`Vira a meia-noite no dia ${p + 1}`} checked={d.crossesMidnight} onCheckedChange={(c) => patch(p, { crossesMidnight: c })} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {daysError && <p role="alert" className="m-0 text-sm font-medium text-danger">{daysError}</p>}
      </fieldset>
      {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
    </form>
  );
}
