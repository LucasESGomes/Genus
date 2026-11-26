'use client';
/**
 * Feriados do estabelecimento (G3, RF14 a RF16): os oficiais (nacionais, da UF e do município) e os
 * da conta. Por estabelecimento: trabalha ou não no feriado, e como trata a hora (pagar a 100% ou banco).
 * Facultativo (Carnaval, Sexta-feira Santa, Corpus Christi) não muda a apuração: para folgar nele,
 * cadastre o feriado da conta na mesma data. Mudar um feriado recalcula os dias já apurados.
 */
import { CalendarBlank, Plus, type Icon } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DataTable } from '@/components/ui/DataTable';
import { DateInput, SelectField, SwitchField, TextInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { Holiday, HolidayScope, HolidayTreatment } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { formatDate, todayCivil } from '@/lib/format';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { HOLIDAY_SCOPE } from './copy';

const TREATMENT: Record<HolidayTreatment, string> = { pagar_100: 'Paga a 100%', banco_horas: 'Vai para o banco de horas' };
const ERRORS: Record<string, string> = {
  CONFLICT: 'Já existe esse feriado nessa data.',
  PERIODO_FECHADO: 'A data está num período já fechado. Reabra o período antes de mudar o feriado.',
};

type Panel = { kind: 'create' } | { kind: 'edit'; holiday: Holiday } | { kind: 'rule'; holiday: Holiday } | null;

export function HolidaysTab() {
  const { me, establishment } = useSession();
  const canEdit = can(me.role, 'holiday.manage');
  const clock = useClock();
  const thisYear = Number(todayCivil(clock).slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [panel, setPanel] = useState<Panel>(null);
  const [removing, setRemoving] = useState<Holiday | null>(null);
  const q = useApiQuery('admin', { holidays: true, year }, (api, signal) => api.admin.holidays(establishment.id, year, signal));
  const remove = useApiMutation((api, id: string) => api.admin.deleteHoliday(id), { invalidates: ['admin', 'timesheets', 'day', 'overview'] });
  const years = [thisYear - 1, thisYear, thisYear + 1].map((y) => ({ value: String(y), label: String(y) }));

  const columns = useMemo<ColumnDef<Holiday, never>[]>(() => [
    { header: 'Data', id: 'date', cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.date, 'medium')}</span> },
    { header: 'Nome', accessorKey: 'name' },
    {
      header: 'Abrangência',
      id: 'scope',
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1">
          {HOLIDAY_SCOPE[row.original.scope]}
          {row.original.isOwn && <StatusBadge tone="good" label="Da conta" />}
          {row.original.isOptional && <StatusBadge tone="neutral" label="Facultativo" />}
        </span>
      ),
    },
    {
      header: 'Neste estabelecimento',
      id: 'rule',
      cell: ({ row }) => {
        const h = row.original;
        if (h.isOptional) return <span className="text-muted">Dia normal</span>;
        return h.isWorked && h.treatment ? `Trabalha · ${TREATMENT[h.treatment]}` : <span className="text-muted">Folga</span>;
      },
    },
    ...(canEdit
      ? [{
          header: () => <span className="sr-only">Ações</span>,
          id: 'actions',
          cell: ({ row }: { row: { original: Holiday } }) => {
            const h = row.original;
            return (
              <span className="flex justify-end gap-1">
                {!h.isOptional && <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: 'rule', holiday: h })}>Trabalha?</Button>}
                {h.isOwn && <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: 'edit', holiday: h })}>Editar</Button>}
                {h.isOwn && <Button size="sm" variant="ghost" onClick={() => setRemoving(h)}>Remover</Button>}
              </span>
            );
          },
        } as ColumnDef<Holiday, never>]
      : []),
  ] as ColumnDef<Holiday, never>[], [canEdit]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-40">
          <SelectField label="Ano" value={String(year)} onValueChange={(v) => setYear(Number(v))} options={years} />
        </div>
        {canEdit && <Button variant="primary" icon={<Plus size={16} aria-hidden />} onClick={() => setPanel({ kind: 'create' })}>Adicionar feriado</Button>}
      </div>
      <p className="m-0 text-xs text-muted text-pretty">
        Os feriados nacionais já vêm cadastrados. Carnaval, Sexta-feira Santa e Corpus Christi aparecem como facultativos e não mudam a apuração: se {establishment.name} folga nesses dias, adicione o feriado da conta na mesma data.
      </p>
      <QueryView
        query={q}
        what="os feriados"
        loading={<Skeleton className="h-48 w-full" />}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState icon={CalendarBlank as Icon} title={`Nenhum feriado em ${year}`} text="Os feriados que valem para este estabelecimento aparecem aqui." />}
      >
        {(holidays) => <DataTable caption={`Feriados de ${year}`} columns={columns} data={holidays} getRowId={(h) => h.id} />}
      </QueryView>

      <SidePanel
        open={panel !== null}
        onOpenChange={(o) => { if (!o) setPanel(null); }}
        title={panel?.kind === 'rule' ? 'Trabalho no feriado' : panel?.kind === 'edit' ? 'Editar feriado' : 'Novo feriado da conta'}
        description={panel?.kind === 'rule' ? `${panel.holiday.name} · ${formatDate(panel.holiday.date)} · ${establishment.name}` : undefined}
        footer={null}
      >
        {panel?.kind === 'rule' && <RuleForm key={panel.holiday.id} holiday={panel.holiday} onDone={() => setPanel(null)} />}
        {(panel?.kind === 'create' || panel?.kind === 'edit') && (
          <HolidayForm key={panel.kind === 'edit' ? panel.holiday.id : 'new'} holiday={panel.kind === 'edit' ? panel.holiday : null} year={year} onDone={() => setPanel(null)} />
        )}
      </SidePanel>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => { if (!o) setRemoving(null); }}
        title="Remover feriado"
        description={removing ? `${removing.name} (${formatDate(removing.date)}) deixa de valer. Os dias já apurados nessa data são recalculados.` : ''}
        confirmLabel="Remover"
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync(removing!.id);
          notify.success('Feriado removido');
          setRemoving(null);
        }}
      />
    </>
  );
}

const ruleSchema = z
  .object({ isWorked: z.boolean(), treatment: z.string() })
  .refine((v) => !v.isWorked || v.treatment !== '', { path: ['treatment'], message: 'Escolha como a hora trabalhada é tratada.' });

function RuleForm({ holiday, onDone }: { holiday: Holiday; onDone: () => void }) {
  const { establishment } = useSession();
  const save = useApiMutation(
    (api, v: z.output<typeof ruleSchema>) =>
      api.admin.setEstablishmentHoliday(establishment.id, holiday.id, { isWorked: v.isWorked, treatment: v.isWorked ? (v.treatment as HolidayTreatment) : null }),
    { invalidates: ['admin', 'timesheets', 'day', 'overview', 'timeBank'] },
  );
  const form = useZodForm(ruleSchema, { isWorked: holiday.isWorked, treatment: holiday.treatment ?? '' });
  const isWorked = form.watch('isWorked');
  const [error, setError] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await save.mutateAsync(v);
      notify.success('Regra do feriado salva');
      onDone();
    } catch (e) {
      const err = asApiError(e);
      setError(ERRORS[err.code] ?? applyApiErrors(form, err));
    }
  });
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label="Trabalho no feriado">
      <Controller
        control={form.control}
        name="isWorked"
        render={({ field }) => (
          <SwitchField label="O estabelecimento trabalha neste feriado" hint="Desligado: é folga e ninguém leva falta. Ligado: o que for trabalhado é hora extra." checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      {isWorked && (
        <Controller
          control={form.control}
          name="treatment"
          render={({ field }) => (
            <SelectField
              label="A hora trabalhada"
              required
              value={field.value}
              onValueChange={field.onChange}
              options={(Object.keys(TREATMENT) as HolidayTreatment[]).map((t) => ({ value: t, label: TREATMENT[t] }))}
              error={form.formState.errors.treatment?.message}
            />
          )}
        />
      )}
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={save.isPending} onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={save.isPending}>Salvar</Button>
      </div>
    </form>
  );
}

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.'),
  name: z.string().trim().min(2, 'Mínimo de 2 letras.').max(120),
  scope: z.enum(['nacional', 'estadual', 'municipal']),
  isOptional: z.boolean(),
});

const SCOPE_OPTIONS: { value: HolidayScope; label: string }[] = [
  { value: 'municipal', label: 'Só no município deste estabelecimento' },
  { value: 'estadual', label: 'No estado deste estabelecimento' },
  { value: 'nacional', label: 'Em todos os estabelecimentos da conta' },
];

function HolidayForm({ holiday, year, onDone }: { holiday: Holiday | null; year: number; onDone: () => void }) {
  const { establishment } = useSession();
  const save = useApiMutation(
    (api, v: z.output<typeof holidaySchema>) =>
      holiday
        ? api.admin.updateHoliday(holiday.id, { date: v.date, name: v.name, isOptional: v.isOptional })
        : api.admin.createHoliday({ establishmentId: establishment.id, ...v }),
    { invalidates: ['admin', 'timesheets', 'day', 'overview'] },
  );
  const form = useZodForm(holidaySchema, {
    date: holiday?.date ?? `${year}-01-01`,
    name: holiday?.name ?? '',
    scope: holiday?.scope ?? 'municipal',
    isOptional: holiday?.isOptional ?? false,
  });
  const { errors } = form.formState;
  const [error, setError] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await save.mutateAsync(v);
      notify.success(holiday ? 'Feriado alterado' : 'Feriado cadastrado');
      onDone();
    } catch (e) {
      const err = asApiError(e);
      setError(ERRORS[err.code] ?? applyApiErrors(form, err));
    }
  });
  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label={holiday ? 'Editar feriado' : 'Novo feriado'}>
      <DateInput label="Data" required {...form.register('date')} error={errors.date?.message} />
      <TextInput label="Nome" required {...form.register('name')} error={errors.name?.message} />
      <Controller
        control={form.control}
        name="scope"
        render={({ field }) => (
          <SelectField label="Onde vale" required value={field.value} onValueChange={field.onChange} options={SCOPE_OPTIONS} disabled={holiday !== null} hint={holiday ? 'A abrangência não muda: remova e cadastre de novo.' : undefined} />
        )}
      />
      <Controller
        control={form.control}
        name="isOptional"
        render={({ field }) => (
          <SwitchField label="Ponto facultativo" hint="Facultativo não muda a apuração: o dia segue a escala." checked={field.value} onCheckedChange={field.onChange} />
        )}
      />
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" disabled={save.isPending} onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={save.isPending}>{holiday ? 'Salvar' : 'Cadastrar'}</Button>
      </div>
    </form>
  );
}
