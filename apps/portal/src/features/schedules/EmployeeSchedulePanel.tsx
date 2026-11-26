'use client';
/**
 * Escala do colaborador (G2, RF09, RF12): vigente e histórico, atribuir, trocar a partir de uma data,
 * encerrar, e trocas pontuais de turno ou folga. rh escreve; admin só lê.
 * Mudar a escala ou o turno de um dia já apurado recalcula o dia no servidor. A marcação original nunca muda.
 */
import { ArrowsClockwise, CalendarX, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateInput, SelectField, SwitchField, TextArea, TimeInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { Employee, EmployeeSchedule, ScheduleOverride } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { addCivilDays, formatDate, todayCivil } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';

const SCHEDULE_ERRORS: Record<string, string> = {
  ESCALA_SOBREPOSTA: 'A vigência se sobrepõe a outra escala do colaborador. Ajuste as datas.',
  ESCALA_INATIVA: 'Esta escala está inativa. Reative-a na tela de Escalas antes de usar.',
  PERIODO_FECHADO: 'A mudança atinge um período já fechado. Reabra o período antes de alterar.',
  CONFLICT: 'Já existe uma troca de turno para este dia.',
};
const messageOf = (code: string, fallback: string) => SCHEDULE_ERRORS[code] ?? fallback;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.');

export function EmployeeSchedulePanel({ employee, open, onOpenChange }: { employee: Employee | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <SidePanel open={open && employee !== null} onOpenChange={onOpenChange} title="Escala" description={employee?.name} width="lg" footer={null}>
      {open && employee && <Body key={employee.id} employee={employee} />}
    </SidePanel>
  );
}

type View = { kind: 'list' } | { kind: 'switch' } | { kind: 'override' };

function Body({ employee }: { employee: Employee }) {
  const { me } = useSession();
  const canEdit = can(me.role, 'schedule.edit');
  const clock = useClock();
  const today = todayCivil(clock);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [ending, setEnding] = useState<EmployeeSchedule | null>(null);

  const history = useApiQuery('schedules', { employee: employee.id }, (api, signal) => api.schedules.employeeSchedules(employee.id, signal));
  const endAssignment = useApiMutation(
    (api, v: { assignmentId: string; validTo: string | null }) => api.schedules.endAssignment(employee.id, v.assignmentId, v.validTo),
    { invalidates: ['schedules', 'timesheets', 'day', 'overview'] },
  );

  if (view.kind === 'switch') return <SwitchForm employee={employee} today={today} hasCurrent={(history.data ?? []).length > 0} onBack={() => setView({ kind: 'list' })} />;
  if (view.kind === 'override') return <OverrideForm employee={employee} today={today} onBack={() => setView({ kind: 'list' })} />;

  const current = (history.data ?? []).find((a) => a.validFrom <= today && (a.validTo === null || today <= a.validTo));

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Escala vigente e histórico" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-bold">Escalas</h3>
          {canEdit && (
            <Button size="sm" variant="secondary" icon={<ArrowsClockwise size={16} aria-hidden />} onClick={() => setView({ kind: 'switch' })}>
              {current ? 'Trocar escala' : 'Atribuir escala'}
            </Button>
          )}
        </div>
        <QueryView
          query={history}
          what="as escalas do colaborador"
          loading={<Skeleton className="h-24 w-full" />}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState icon={CalendarX} title="Sem escala" text="Sem escala, o dia não é apurado: as marcações ficam guardadas, mas não viram horas." />}
        >
          {(rows) => (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {[...rows].reverse().map((a) => {
                const isCurrent = a.id === current?.id;
                const isFuture = a.validFrom > today;
                return (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                    <div className="flex flex-col">
                      <span className="font-semibold">{a.scheduleName}</span>
                      <span className="text-xs text-muted tabular-nums">
                        {formatDate(a.validFrom)} {a.validTo ? `a ${formatDate(a.validTo)}` : 'em diante'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isCurrent && <StatusBadge tone="good" label="Vigente" />}
                      {isFuture && <StatusBadge tone="neutral" label="Futura" />}
                      {canEdit && a.validTo === null && (
                        <Button size="sm" variant="ghost" onClick={() => setEnding(a)}>Encerrar</Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryView>
      </section>

      <OverridesSection employee={employee} today={today} canEdit={canEdit} onAdd={() => setView({ kind: 'override' })} />

      <EndAssignmentDialog
        assignment={ending}
        defaultDate={today}
        onClose={() => setEnding(null)}
        onConfirm={async (validTo) => {
          await endAssignment.mutateAsync({ assignmentId: ending!.id, validTo });
          notify.success('Escala encerrada');
        }}
      />
    </div>
  );
}

function EndAssignmentDialog({ assignment, defaultDate, onClose, onConfirm }: {
  assignment: EmployeeSchedule | null;
  defaultDate: string;
  onClose: () => void;
  onConfirm: (validTo: string) => Promise<void>;
}) {
  const [value, setValue] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  return (
    <SidePanel
      open={assignment !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Encerrar escala"
      description={assignment ? `${assignment.scheduleName}, desde ${formatDate(assignment.validFrom)}` : undefined}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => {
              setError(null);
              onConfirm(value).then(onClose, (e: unknown) => {
                const err = asApiError(e);
                setError(messageOf(err.code, err.message));
              });
            }}
          >
            Encerrar
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-3">
        <DateInput label="Último dia nesta escala" required value={value} min={assignment?.validFrom} onChange={(e) => setValue(e.target.value)} />
        <p className="m-0 text-sm text-muted">Depois desse dia o colaborador fica sem escala até receber outra. Dias já apurados depois dele são recalculados.</p>
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      </div>
    </SidePanel>
  );
}

const switchSchema = z.object({ scheduleId: z.string().min(1, 'Escolha a escala.'), validFrom: date });

function SwitchForm({ employee, today, hasCurrent, onBack }: { employee: Employee; today: string; hasCurrent: boolean; onBack: () => void }) {
  const options = useApiQuery(
    'schedules',
    { options: employee.establishmentId },
    (api, signal) => api.schedules.list({ establishmentId: employee.establishmentId, status: 'ativa' }, signal),
  );
  const save = useApiMutation(
    (api, v: z.output<typeof switchSchema>) => api.schedules.switchSchedule(employee.id, v),
    { invalidates: ['schedules', 'timesheets', 'day', 'overview'] },
  );
  const form = useZodForm(switchSchema, { scheduleId: '', validFrom: today });
  const [formError, setFormError] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync(v);
      notify.success(hasCurrent ? 'Escala trocada' : 'Escala atribuída');
      onBack();
    } catch (e) {
      const err = asApiError(e);
      setFormError(SCHEDULE_ERRORS[err.code] ?? applyApiErrors(form, err));
    }
  });
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label={hasCurrent ? 'Trocar escala' : 'Atribuir escala'}>
      <p className="m-0 text-sm text-muted">
        {hasCurrent
          ? 'A escala atual termina no dia anterior à data escolhida e a nova começa nela. Dias já apurados a partir dessa data são recalculados.'
          : 'A escala vale a partir da data escolhida.'}
      </p>
      <Controller
        control={form.control}
        name="scheduleId"
        render={({ field }) => (
          <SelectField
            label="Escala"
            required
            value={field.value}
            onValueChange={field.onChange}
            options={(options.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            placeholder={options.isPending ? 'Carregando…' : 'Selecione'}
            error={form.formState.errors.scheduleId?.message}
          />
        )}
      />
      {options.data?.length === 0 && <p className="m-0 text-sm text-warn">Nenhuma escala ativa neste estabelecimento. Cadastre uma na tela de Escalas.</p>}
      <DateInput label="A partir de" required {...form.register('validFrom')} error={form.formState.errors.validFrom?.message} />
      {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={save.isPending} onClick={onBack}>Voltar</Button>
        <Button type="submit" loading={save.isPending}>{hasCurrent ? 'Trocar' : 'Atribuir'}</Button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ trocas de turno

function OverridesSection({ employee, today, canEdit, onAdd }: { employee: Employee; today: string; canEdit: boolean; onAdd: () => void }) {
  const from = addCivilDays(today, -31);
  const to = addCivilDays(today, 92);
  const q = useApiQuery('schedules', { overrides: employee.id, from, to }, (api, signal) => api.schedules.overrides(employee.id, from, to, signal));
  const [removing, setRemoving] = useState<ScheduleOverride | null>(null);
  const remove = useApiMutation(
    (api, id: string) => api.schedules.deleteOverride(employee.id, id),
    { invalidates: ['schedules', 'timesheets', 'day'] },
  );
  return (
    <section aria-label="Trocas de turno" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="m-0 text-sm font-bold">Trocas de turno</h3>
          <p className="m-0 text-xs text-muted">Muda só o horário previsto de um dia. Do último mês aos próximos três.</p>
        </div>
        {canEdit && <Button size="sm" variant="secondary" icon={<Plus size={16} aria-hidden />} onClick={onAdd}>Nova troca</Button>}
      </div>
      <QueryView
        query={q}
        what="as trocas de turno"
        loading={<Skeleton className="h-16 w-full" />}
        isEmpty={(d) => d.length === 0}
        empty={<p className="m-0 text-sm text-muted">Nenhuma troca de turno no período.</p>}
      >
        {(rows) => (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {rows.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <div className="flex flex-col">
                  <span className="font-semibold tabular-nums">
                    {formatDate(o.date, 'medium')} · {o.isDayOff ? 'Folga' : `${o.startTime} às ${o.endTime}`}
                  </span>
                  <span className="text-xs text-muted">{o.reason}</span>
                </div>
                {canEdit && (
                  <Button size="sm" variant="ghost" icon={<Trash size={16} aria-hidden />} aria-label={`Remover a troca de ${formatDate(o.date)}`} onClick={() => setRemoving(o)}>
                    Remover
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title="Remover troca de turno"
        description={removing ? `O dia ${formatDate(removing.date)} volta ao horário da escala.` : ''}
        confirmLabel="Remover"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync(removing!.id);
          notify.success('Troca removida');
          setRemoving(null);
        }}
      />
    </section>
  );
}

const time = z.string();
const overrideSchema = z
  .object({ date, isDayOff: z.boolean(), startTime: time, endTime: time, reason: z.string().trim().min(3, 'Escreva o motivo.').max(500) })
  .refine((v) => v.isDayOff || (/^\d{2}:\d{2}$/.test(v.startTime) && /^\d{2}:\d{2}$/.test(v.endTime)), { path: ['startTime'], message: 'Informe entrada e saída.' });

function OverrideForm({ employee, today, onBack }: { employee: Employee; today: string; onBack: () => void }) {
  const save = useApiMutation(
    (api, v: z.output<typeof overrideSchema>) =>
      api.schedules.createOverride(employee.id, {
        date: v.date,
        isDayOff: v.isDayOff,
        startTime: v.isDayOff ? null : v.startTime,
        endTime: v.isDayOff ? null : v.endTime,
        reason: v.reason,
      }),
    { invalidates: ['schedules', 'timesheets', 'day'] },
  );
  const form = useZodForm(overrideSchema, { date: today, isDayOff: false, startTime: '', endTime: '', reason: '' });
  const isDayOff = form.watch('isDayOff');
  const [formError, setFormError] = useState<string | null>(null);
  const { errors } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync(v);
      notify.success('Troca de turno registrada');
      onBack();
    } catch (e) {
      const err = asApiError(e);
      setFormError(SCHEDULE_ERRORS[err.code] ?? applyApiErrors(form, err));
    }
  });
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label="Nova troca de turno">
      <p className="m-0 text-sm text-muted">Vale só para o dia escolhido. As marcações do colaborador não mudam.</p>
      <DateInput label="Dia" required {...form.register('date')} error={errors.date?.message} />
      <Controller
        control={form.control}
        name="isDayOff"
        render={({ field }) => <SwitchField label="Folga neste dia" checked={field.value} onCheckedChange={field.onChange} />}
      />
      {!isDayOff && (
        <div className="grid grid-cols-2 gap-3">
          <TimeInput label="Entrada" required {...form.register('startTime')} error={errors.startTime?.message} />
          <TimeInput label="Saída" required {...form.register('endTime')} error={errors.endTime?.message} />
        </div>
      )}
      <TextArea label="Motivo" required rows={3} {...form.register('reason')} error={errors.reason?.message} />
      {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={save.isPending} onClick={onBack}>Voltar</Button>
        <Button type="submit" loading={save.isPending}>Registrar</Button>
      </div>
    </form>
  );
}
