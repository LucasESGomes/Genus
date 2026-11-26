'use client';
/**
 * Estrutura da empresa (G1, RF02): setores do estabelecimento, cargos e centros de custo da empresa.
 * Sem excluir: um item pode estar num vínculo (o histórico do colaborador não perde a referência).
 * rh e admin escrevem; o nome repetido volta como 409 NOME_DUPLICADO / CODIGO_DUPLICADO.
 */
import { Plus, TreeStructure, type Icon } from '@phosphor-icons/react';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { TextInput } from '@/components/ui/Fields';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { CostCenter, Department, EntityId, JobTitle } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { ORG_COPY as COPY } from './copy';

type Kind = 'department' | 'jobTitle' | 'costCenter';
type Editing<T> = { mode: 'create' } | { mode: 'edit'; item: T } | null;

const DUPLICATE: Record<string, string> = {
  NOME_DUPLICADO: COPY.duplicateName,
  CODIGO_DUPLICADO: COPY.duplicateCode,
};

export function OrgUnitsSection() {
  const { me, establishment } = useSession();
  const canEdit = can(me.role, 'org.manage');
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-muted text-pretty">{COPY.intro(establishment.name)}</p>
      <DepartmentsCard establishmentId={establishment.id} canEdit={canEdit} />
      <JobTitlesCard establishmentId={establishment.id} canEdit={canEdit} />
      <CostCentersCard establishmentId={establishment.id} canEdit={canEdit} />
    </div>
  );
}

function CardShell({ title, hint, onAdd, canEdit, children }: { title: string; hint: string; onAdd: () => void; canEdit: boolean; children: React.ReactNode }) {
  return (
    <Card as="section" className="flex flex-col gap-3 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{title}</h2>
          <p className="m-0 text-xs text-muted">{hint}</p>
        </div>
        {canEdit && <Button variant="secondary" size="sm" icon={<Plus size={16} aria-hidden />} onClick={onAdd}>{COPY.add}</Button>}
      </div>
      {children}
    </Card>
  );
}

const TableSkeleton = () => <Skeleton className="h-32 w-full" />;
const empty = (what: string) => <EmptyState icon={TreeStructure as Icon} title={COPY.emptyTitle(what)} text={COPY.emptyText} />;

function editColumn<T extends { id: EntityId; name: string }>(canEdit: boolean, onEdit: (item: T) => void): ColumnDef<T, never>[] {
  if (!canEdit) return [];
  return [{
    header: '',
    id: 'actions',
    enableSorting: false,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" aria-label={`${COPY.edit} ${row.original.name}`} onClick={() => onEdit(row.original)}>{COPY.edit}</Button>
      </div>
    ),
  }];
}

// ------------------------------------------------------------------ setores

function DepartmentsCard({ establishmentId, canEdit }: { establishmentId: EntityId; canEdit: boolean }) {
  const q = useApiQuery('org', { departments: establishmentId }, (api, signal) => api.org.departments(establishmentId, signal));
  const [editing, setEditing] = useState<Editing<Department>>(null);
  const columns = useMemo<ColumnDef<Department, never>[]>(() => [
    { header: 'Setor', accessorKey: 'name' },
    { header: 'Férias simultâneas (máx.)', id: 'max', cell: ({ row }) => <span className="tabular-nums">{row.original.maxSimultaneousVacations}</span> },
    ...editColumn<Department>(canEdit, (item) => setEditing({ mode: 'edit', item })),
  ] as ColumnDef<Department, never>[], [canEdit]);
  return (
    <CardShell title={COPY.departments} hint={COPY.departmentsHint} canEdit={canEdit} onAdd={() => setEditing({ mode: 'create' })}>
      <QueryView query={q} what="os setores" loading={<TableSkeleton />} isEmpty={(d) => d.length === 0} empty={empty('setor')}>
        {(rows) => <DataTable caption={COPY.departments} columns={columns} data={rows} getRowId={(r) => r.id} sortable />}
      </QueryView>
      <DepartmentPanel establishmentId={establishmentId} editing={editing} onClose={() => setEditing(null)} />
    </CardShell>
  );
}

const departmentSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo de 2 letras.').max(100),
  maxSimultaneousVacations: z.number({ error: 'Informe um número.' }).int('Use um número inteiro.').min(1, 'O mínimo é 1.').max(999),
});

function DepartmentPanel({ establishmentId, editing, onClose }: { establishmentId: EntityId; editing: Editing<Department>; onClose: () => void }) {
  const save = useApiMutation(
    (api, v: z.output<typeof departmentSchema>) =>
      editing?.mode === 'edit' ? api.org.updateDepartment(editing.item.id, v) : api.org.createDepartment({ establishmentId, ...v }),
    { invalidates: ['org', 'vacationCalendar'] },
  );
  const item = editing?.mode === 'edit' ? editing.item : null;
  return (
    <UnitPanel
      kind="department"
      editing={editing}
      onClose={onClose}
      pending={save.isPending}
      schema={departmentSchema}
      defaults={{ name: item?.name ?? '', maxSimultaneousVacations: item?.maxSimultaneousVacations ?? 1 }}
      onSubmit={(v) => save.mutateAsync(v)}
      fields={(form) => (
        <>
          <TextInput label="Nome do setor" required {...form.register('name')} error={errorOf(form, 'name')} />
          <TextInput
            label="Férias simultâneas (máximo)"
            hint={COPY.vacationsHint}
            type="number"
            inputMode="numeric"
            min={1}
            required
            {...form.register('maxSimultaneousVacations', { valueAsNumber: true })}
            error={errorOf(form, 'maxSimultaneousVacations')}
          />
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------ cargos

function JobTitlesCard({ establishmentId, canEdit }: { establishmentId: EntityId; canEdit: boolean }) {
  const q = useApiQuery('org', { jobTitles: establishmentId }, (api, signal) => api.org.jobTitles(establishmentId, signal));
  const [editing, setEditing] = useState<Editing<JobTitle>>(null);
  const columns = useMemo<ColumnDef<JobTitle, never>[]>(() => [
    { header: 'Cargo', accessorKey: 'name' },
    { header: 'CBO', id: 'cbo', cell: ({ row }) => <span className="tabular-nums">{row.original.cbo ?? '—'}</span> },
    ...editColumn<JobTitle>(canEdit, (item) => setEditing({ mode: 'edit', item })),
  ] as ColumnDef<JobTitle, never>[], [canEdit]);
  return (
    <CardShell title={COPY.jobTitles} hint={COPY.jobTitlesHint} canEdit={canEdit} onAdd={() => setEditing({ mode: 'create' })}>
      <QueryView query={q} what="os cargos" loading={<TableSkeleton />} isEmpty={(d) => d.length === 0} empty={empty('cargo')}>
        {(rows) => <DataTable caption={COPY.jobTitles} columns={columns} data={rows} getRowId={(r) => r.id} sortable />}
      </QueryView>
      <JobTitlePanel establishmentId={establishmentId} editing={editing} onClose={() => setEditing(null)} />
    </CardShell>
  );
}

const jobTitleSchema = z.object({
  name: z.string().trim().min(2, 'Mínimo de 2 letras.').max(100),
  cbo: z.string().trim().refine((v) => v === '' || /^\d{6}$/.test(v), 'O CBO tem 6 dígitos.'),
});

function JobTitlePanel({ establishmentId, editing, onClose }: { establishmentId: EntityId; editing: Editing<JobTitle>; onClose: () => void }) {
  const save = useApiMutation(
    (api, v: z.output<typeof jobTitleSchema>) => {
      const body = { name: v.name, cbo: v.cbo === '' ? null : v.cbo };
      return editing?.mode === 'edit' ? api.org.updateJobTitle(editing.item.id, body) : api.org.createJobTitle({ establishmentId, ...body });
    },
    { invalidates: ['org'] },
  );
  const item = editing?.mode === 'edit' ? editing.item : null;
  return (
    <UnitPanel
      kind="jobTitle"
      editing={editing}
      onClose={onClose}
      pending={save.isPending}
      schema={jobTitleSchema}
      defaults={{ name: item?.name ?? '', cbo: item?.cbo ?? '' }}
      onSubmit={(v) => save.mutateAsync(v)}
      fields={(form) => (
        <>
          <TextInput label="Nome do cargo" required {...form.register('name')} error={errorOf(form, 'name')} />
          <TextInput label="CBO" hint={COPY.cboHint} inputMode="numeric" maxLength={6} {...form.register('cbo')} error={errorOf(form, 'cbo')} />
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------ centros de custo

function CostCentersCard({ establishmentId, canEdit }: { establishmentId: EntityId; canEdit: boolean }) {
  const q = useApiQuery('org', { costCenters: establishmentId }, (api, signal) => api.org.costCenters(establishmentId, signal));
  const [editing, setEditing] = useState<Editing<CostCenter>>(null);
  const columns = useMemo<ColumnDef<CostCenter, never>[]>(() => [
    { header: 'Código', id: 'code', cell: ({ row }) => <span className="tabular-nums">{row.original.code}</span> },
    { header: 'Nome', accessorKey: 'name' },
    ...editColumn<CostCenter>(canEdit, (item) => setEditing({ mode: 'edit', item })),
  ] as ColumnDef<CostCenter, never>[], [canEdit]);
  return (
    <CardShell title={COPY.costCenters} hint={COPY.costCentersHint} canEdit={canEdit} onAdd={() => setEditing({ mode: 'create' })}>
      <QueryView query={q} what="os centros de custo" loading={<TableSkeleton />} isEmpty={(d) => d.length === 0} empty={empty('centro de custo')}>
        {(rows) => <DataTable caption={COPY.costCenters} columns={columns} data={rows} getRowId={(r) => r.id} sortable />}
      </QueryView>
      <CostCenterPanel establishmentId={establishmentId} editing={editing} onClose={() => setEditing(null)} />
    </CardShell>
  );
}

const costCenterSchema = z.object({
  code: z.string().trim().min(1, 'Informe o código.').max(30),
  name: z.string().trim().min(2, 'Mínimo de 2 letras.').max(100),
});

function CostCenterPanel({ establishmentId, editing, onClose }: { establishmentId: EntityId; editing: Editing<CostCenter>; onClose: () => void }) {
  const save = useApiMutation(
    (api, v: z.output<typeof costCenterSchema>) =>
      editing?.mode === 'edit' ? api.org.updateCostCenter(editing.item.id, v) : api.org.createCostCenter({ establishmentId, ...v }),
    { invalidates: ['org'] },
  );
  const item = editing?.mode === 'edit' ? editing.item : null;
  return (
    <UnitPanel
      kind="costCenter"
      editing={editing}
      onClose={onClose}
      pending={save.isPending}
      schema={costCenterSchema}
      defaults={{ code: item?.code ?? '', name: item?.name ?? '' }}
      onSubmit={(v) => save.mutateAsync(v)}
      fields={(form) => (
        <>
          <TextInput label="Código" required {...form.register('code')} error={errorOf(form, 'code')} />
          <TextInput label="Nome" required {...form.register('name')} error={errorOf(form, 'name')} />
        </>
      )}
    />
  );
}

// ------------------------------------------------------------------ painel comum

const FORM_ID = 'org-unit-form';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = ReturnType<typeof useZodForm<any>>;

const errorOf = (form: AnyForm, name: string): string | undefined => {
  const m = form.formState.errors[name]?.message;
  return typeof m === 'string' ? m : undefined;
};

function UnitPanel<S extends z.ZodObject>({ kind, editing, onClose, pending, schema, defaults, onSubmit, fields }: {
  kind: Kind;
  editing: Editing<unknown>;
  onClose: () => void;
  pending: boolean;
  schema: S;
  defaults: z.input<S>;
  onSubmit: (v: z.output<S>) => Promise<unknown>;
  fields: (form: AnyForm) => React.ReactNode;
}) {
  const open = editing !== null;
  const isEdit = editing?.mode === 'edit';
  return (
    <SidePanel
      open={open}
      onOpenChange={(o) => { if (!o && !pending) onClose(); }}
      title={isEdit ? COPY.editTitle[kind] : COPY.createTitle[kind]}
      description={COPY.panelHint}
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>Cancelar</Button>
          <Button type="submit" form={FORM_ID} loading={pending}>{isEdit ? 'Salvar' : 'Adicionar'}</Button>
        </>
      )}
    >
      {/* key: o formulário renasce com os valores do item escolhido */}
      {open && <UnitForm key={isEdit ? 'edit' : 'create'} schema={schema} defaults={defaults} onSubmit={onSubmit} onDone={onClose} fields={fields} />}
    </SidePanel>
  );
}

function UnitForm<S extends z.ZodObject>({ schema, defaults, onSubmit, onDone, fields }: {
  schema: S;
  defaults: z.input<S>;
  onSubmit: (v: z.output<S>) => Promise<unknown>;
  onDone: () => void;
  fields: (form: AnyForm) => React.ReactNode;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useZodForm(schema as any, defaults as any) as AnyForm;
  const [formError, setFormError] = useState<string | null>(null);
  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await onSubmit(v as z.output<S>);
      notify.success(COPY.saved);
      onDone();
    } catch (e) {
      const err = asApiError(e);
      setFormError(DUPLICATE[err.code] ?? applyApiErrors(form, err));
    }
  });
  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {fields(form)}
      {formError && <p role="alert" className="m-0 text-sm text-danger">{formError}</p>}
    </form>
  );
}
