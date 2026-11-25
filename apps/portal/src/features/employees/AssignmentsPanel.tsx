'use client';
/**
 * Vínculos do colaborador (cargo, setor, centro de custo, contrato, salário, vigência). Painel aberto a
 * partir da lista. Cargo, setor e centro de custo aparecem pelo NOME (listas de org, mock enquanto o back
 * não tem as rotas). Salário só para quem a api libera (rh e admin); aqui o front só esconde.
 * [A CONFIRMAR] salário: back libera rh e admin, security-lgpd.md diz "só RH" (mapa §8).
 */
import { Briefcase, Plus } from '@phosphor-icons/react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { DateInput, SelectField, TextInput, type SelectOption } from '@/components/ui/Fields';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { Assignment, Employee, OrgUnit } from '@/lib/api/contracts';
import { CONTRACT_TYPES } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { CONTRACT_TYPE } from '@/lib/labels';
import { useSession } from '@/lib/session';
import { useAssignments, useCreateAssignment, useOrgNames, useUpdateAssignment } from './hooks';
import { assignmentSchema, NONE, salaryToApi } from './schemas';

const FORM_ID = 'assignment-form';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const nameOf = (list: OrgUnit[] | undefined, id: string | null) => (id === null ? '—' : (list?.find((u) => u.id === id)?.name ?? 'Não informado'));
const toOptions = (list: OrgUnit[] | undefined): SelectOption[] => (list ?? []).map((u) => ({ value: u.id, label: u.name }));

type View = { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; assignment: Assignment };

export function AssignmentsPanel({ employee, open, onOpenChange }: { employee: Employee | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <SidePanel
      open={open && employee !== null}
      onOpenChange={onOpenChange}
      title="Vínculos"
      description={employee ? employee.name : undefined}
      width="lg"
      footer={null}
    >
      {open && employee && <PanelBody key={employee.id} employee={employee} onClose={() => onOpenChange(false)} />}
    </SidePanel>
  );
}

function PanelBody({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { me } = useSession();
  const allowed = can(me.role, 'assignment.view');
  const [view, setView] = useState<View>({ kind: 'list' });
  const query = useAssignments(employee.id, allowed);
  const org = useOrgNames(employee.establishmentId, allowed);
  const canEdit = can(me.role, 'assignment.edit');
  const canSalary = can(me.role, 'employee.viewSalary');

  if (!allowed) return <p className="m-0 text-muted">Seu perfil não consulta os vínculos deste colaborador.</p>;

  if (view.kind !== 'list') {
    return (
      <AssignmentForm
        employee={employee}
        assignment={view.kind === 'edit' ? view.assignment : null}
        org={{ departments: org.departments.data, jobTitles: org.jobTitles.data, costCenters: org.costCenters.data }}
        canSalary={canSalary}
        onBack={() => setView({ kind: 'list' })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="secondary" icon={<Plus size={16} aria-hidden />} onClick={() => setView({ kind: 'create' })}>Novo vínculo</Button>
        </div>
      )}
      <QueryView
        query={query}
        what="os vínculos"
        loading={<div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-3"><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>}
        isEmpty={(list) => list.length === 0}
        empty={<EmptyState icon={Briefcase} title="Nenhum vínculo" text="Sem vínculo, o colaborador não tem cargo nem setor. Cadastre o primeiro." />}
      >
        {(list) => (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {list.map((a) => (
              <li key={a.id} className="rounded-card border border-line bg-white p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{nameOf(org.jobTitles.data, a.jobTitleId)}</div>
                    <div className="text-xs text-muted tabular-nums">{formatDate(a.validFrom)} a {a.validTo ? formatDate(a.validTo) : 'em aberto'}</div>
                  </div>
                  {canEdit && <Button variant="ghost" size="sm" aria-label={`Editar vínculo de ${nameOf(org.jobTitles.data, a.jobTitleId)}`} onClick={() => setView({ kind: 'edit', assignment: a })}>Editar</Button>}
                </div>
                <KeyValueList
                  items={[
                    { label: 'Setor', value: nameOf(org.departments.data, a.departmentId) },
                    { label: 'Centro de custo', value: nameOf(org.costCenters.data, a.costCenterId) },
                    { label: 'Contrato', value: CONTRACT_TYPE[a.contractType].label },
                    ...(canSalary ? [{ label: 'Salário base', value: a.baseSalary ? brl.format(Number(a.baseSalary)) : 'Não informado' }] : []),
                  ]}
                />
                {canSalary && a.salaryPendingAccountantReview && <p className="m-0 mt-2 text-xs text-muted">Salário aguardando revisão do contador.</p>}
              </li>
            ))}
          </ul>
        )}
      </QueryView>
      <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Fechar</Button></div>
    </div>
  );
}

function AssignmentForm({ employee, assignment, org, canSalary, onBack }: {
  employee: Employee;
  assignment: Assignment | null;
  org: { departments?: OrgUnit[]; jobTitles?: OrgUnit[]; costCenters?: OrgUnit[] };
  canSalary: boolean;
  onBack: () => void;
}) {
  const editing = assignment !== null;
  const form = useZodForm(assignmentSchema, {
    jobTitleId: assignment?.jobTitleId ?? '',
    departmentId: assignment?.departmentId ?? '',
    costCenterId: assignment?.costCenterId ?? NONE,
    contractType: assignment?.contractType ?? 'indeterminado',
    baseSalary: assignment?.baseSalary ? assignment.baseSalary.replace('.', ',') : '',
    validFrom: assignment?.validFrom ?? '',
    validTo: assignment?.validTo ?? '',
  });
  const create = useCreateAssignment();
  const update = useUpdateAssignment();
  const [formError, setFormError] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    const costCenterId = v.costCenterId === NONE ? null : v.costCenterId;
    try {
      if (assignment) {
        await update.mutateAsync({
          id: employee.id,
          assignmentId: assignment.id,
          body: { costCenterId, contractType: v.contractType, ...(canSalary ? { baseSalary: salaryToApi(v.baseSalary) } : {}), validTo: v.validTo || null },
        });
      } else {
        await create.mutateAsync({
          id: employee.id,
          body: {
            jobTitleId: v.jobTitleId,
            departmentId: v.departmentId,
            costCenterId,
            contractType: v.contractType,
            ...(canSalary ? { baseSalary: salaryToApi(v.baseSalary) } : {}),
            validFrom: v.validFrom,
            validTo: v.validTo || null,
          },
        });
      }
      notify.success(editing ? 'Vínculo atualizado' : 'Vínculo criado');
      onBack();
    } catch (e) {
      const err = asApiError(e);
      if (err.code === 'VINCULO_SOBREPOSTO') setFormError('Este vínculo se sobrepõe a outro do colaborador. Encerre o vínculo anterior antes de começar o novo.');
      else setFormError(applyApiErrors(form, err));
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <h3 className="m-0 text-base font-bold">{editing ? 'Editar vínculo' : 'Novo vínculo'}</h3>
      {editing ? (
        <>
          <TextInput label="Cargo" readOnly value={nameOf(org.jobTitles, assignment.jobTitleId)} hint="Cargo e setor não mudam: para mudar, encerre este vínculo e crie outro." />
          <TextInput label="Setor" readOnly value={nameOf(org.departments, assignment.departmentId)} />
        </>
      ) : (
        <>
          <Controller control={form.control} name="jobTitleId" render={({ field }) => (
            <SelectField label="Cargo" required value={field.value} onValueChange={field.onChange} options={toOptions(org.jobTitles)} error={errors.jobTitleId?.message} />
          )} />
          <Controller control={form.control} name="departmentId" render={({ field }) => (
            <SelectField label="Setor" required value={field.value} onValueChange={field.onChange} options={toOptions(org.departments)} error={errors.departmentId?.message} />
          )} />
        </>
      )}
      <Controller control={form.control} name="costCenterId" render={({ field }) => (
        <SelectField label="Centro de custo" value={field.value} onValueChange={field.onChange} options={[{ value: NONE, label: 'Sem centro de custo' }, ...toOptions(org.costCenters)]} error={errors.costCenterId?.message} />
      )} />
      <Controller control={form.control} name="contractType" render={({ field }) => (
        <SelectField label="Tipo de contrato" required value={field.value} onValueChange={field.onChange} options={CONTRACT_TYPES.map((c) => ({ value: c, label: CONTRACT_TYPE[c].label }))} error={errors.contractType?.message} />
      )} />
      {canSalary && (
        <TextInput label="Salário base (R$)" inputMode="decimal" autoComplete="off" placeholder="2500,00" hint="Opcional." error={errors.baseSalary?.message} {...form.register('baseSalary')} />
      )}
      {editing
        ? <TextInput label="Início da vigência" readOnly value={formatDate(assignment.validFrom)} />
        : <DateInput label="Início da vigência" required error={errors.validFrom?.message} {...form.register('validFrom')} />}
      <DateInput label="Fim da vigência" hint="Deixe vazio para vínculo em aberto." error={errors.validTo?.message} {...form.register('validTo')} />
      {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={pending} onClick={onBack}>Voltar</Button>
        <Button type="submit" loading={pending}>{editing ? 'Salvar' : 'Criar vínculo'}</Button>
      </div>
    </form>
  );
}
