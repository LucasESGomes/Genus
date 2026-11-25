'use client';
/**
 * Detalhe do colaborador no calendário de férias: períodos aquisitivos (direito, saldo, prazo, faltas, histórico),
 * cancelamento de férias aprovadas futuras (rh) e "Lançar férias" (rh). Saldos e prazos vêm da api.
 */
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { FormAlert, remapFields } from '../adjustments/parts';
import { useEmployeeOptions } from '../adjustments/useEmployeeOptions';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateInput, SelectField, TextInput } from '@/components/ui/Fields';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { SidePanel } from '@/components/ui/SidePanel';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { AccrualPeriod, Role, Vacation } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { formatDate, plural } from '@/lib/format';
import { VACATION_STATUS } from '@/lib/labels';
import { useApiMutation, useApiQuery } from '@/lib/query/hooks';
import { COPY } from './copy';
import { launchVacationSchema } from './schemas';

const FORM_ID = 'vacation-launch-form';
const MODULES = ['vacations', 'vacationCalendar', 'overview'] as const;

export function EmployeeVacationPanel({ open, employeeId, launching, name, role, today, onPick, onClose }: {
  open: boolean;
  employeeId: string | null;
  /** Abriu pelo "Lançar férias": o formulário já aparece. */
  launching: boolean;
  name: string;
  role: Role;
  /** AAAA-MM-DD, do Clock da tela. */
  today: string;
  onPick: (employeeId: string) => void;
  onClose: () => void;
}) {
  return (
    <SidePanel
      open={open}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={employeeId ? name : COPY.panelTitleNew}
      description={employeeId ? 'Períodos aquisitivos e férias do colaborador' : 'Escolha o colaborador para lançar as férias.'}
      width="lg"
    >
      {open && (employeeId
        ? <Body key={employeeId} employeeId={employeeId} launching={launching} role={role} today={today} />
        : <Picker onPick={onPick} />)}
    </SidePanel>
  );
}

function Picker({ onPick }: { onPick: (id: string) => void }) {
  const employees = useEmployeeOptions();
  return (
    <SelectField
      label={COPY.pickEmployee}
      required
      value=""
      onValueChange={onPick}
      options={employees.options}
      placeholder={employees.isPending ? 'Carregando…' : 'Selecione'}
    />
  );
}

function Body({ employeeId, launching, role, today }: { employeeId: string; launching: boolean; role: Role; today: string }) {
  const [showForm, setShowForm] = useState(launching);
  const [cancelling, setCancelling] = useState<Vacation | null>(null);
  const periods = useApiQuery('vacations', { periods: employeeId }, (api, signal) => api.vacations.periods(employeeId, signal));
  const cancel = useApiMutation((api, v: { id: string; reason: string }) => api.vacations.cancel(v.id, { reason: v.reason }), { invalidates: [...MODULES] });
  const canCreate = can(role, 'vacation.create');
  const canCancel = can(role, 'vacation.cancel');

  return (
    <div className="flex flex-col gap-5">
      {canCreate && !showForm && (
        <div><Button variant="secondary" onClick={() => setShowForm(true)}>{COPY.launch}</Button></div>
      )}
      {canCreate && showForm && (
        <LaunchForm employeeId={employeeId} periods={periods.data ?? []} onDone={() => setShowForm(false)} />
      )}
      <QueryView
        query={periods}
        what="os períodos de férias"
        loading={<div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
        isEmpty={(p) => p.length === 0}
        empty={<p className="m-0 text-sm text-muted">{COPY.noPeriods}</p>}
      >
        {(list) => (
          <section aria-label={COPY.periodsTitle} className="flex flex-col gap-4">
            {list.map((p) => (
              <PeriodCard key={p.id} period={p} today={today} canCancel={canCancel} onCancel={setCancelling} />
            ))}
          </section>
        )}
      </QueryView>
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(o) => { if (!o) setCancelling(null); }}
        title={COPY.cancelTitle}
        description={COPY.cancelText}
        confirmLabel="Cancelar férias"
        tone="danger"
        reason={{ label: 'Motivo do cancelamento', min: 3, max: 500 }}
        onConfirm={async (reason) => {
          if (!cancelling) return;
          await cancel.mutateAsync({ id: cancelling.id, reason: reason ?? '' });
          notify.success('Férias canceladas');
        }}
      />
    </div>
  );
}

function PeriodCard({ period: p, today, canCancel, onCancel }: { period: AccrualPeriod; today: string; canCancel: boolean; onCancel: (v: Vacation) => void }) {
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-white p-4">
      <h3 className="m-0 text-sm font-bold">{formatDate(p.startDate)} a {formatDate(p.endDate)}</h3>
      <KeyValueList
        items={[
          { label: 'Direito', value: plural(p.entitledDays, 'dia', 'dias') },
          { label: 'Saldo', value: plural(p.remainingDays, 'dia', 'dias') },
          { label: 'Prazo para conceder', value: formatDate(p.grantDeadline) },
          { label: 'Faltas injustificadas', value: String(p.unjustifiedAbsences) },
        ]}
      />
      {p.vacations.length === 0 ? (
        <p className="m-0 text-sm text-muted">Nenhuma férias neste período.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {p.vacations.map((v) => {
            const st = VACATION_STATUS[v.status];
            return (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2 text-sm">
                <span className="flex flex-col">
                  <span className="font-semibold tabular-nums">{formatDate(v.startDate)} a {formatDate(v.endDate)}</span>
                  <span className="text-xs text-muted">
                    {plural(v.days, 'dia', 'dias')}
                    {v.cashBonusDays > 0 ? ` · abono de ${plural(v.cashBonusDays, 'dia', 'dias')}` : ''}
                    {v.daysPaidInDouble > 0 ? ` · ${plural(v.daysPaidInDouble, 'dia pago', 'dias pagos')} em dobro` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge label={st.label} tone={st.tone} />
                  {canCancel && v.status === 'aprovada' && v.startDate > today && (
                    <Button variant="secondary" size="sm" aria-label={`Cancelar férias de ${formatDate(v.startDate)} a ${formatDate(v.endDate)}`} onClick={() => onCancel(v)}>Cancelar</Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function LaunchForm({ employeeId, periods, onDone }: { employeeId: string; periods: AccrualPeriod[]; onDone: () => void }) {
  const form = useZodForm(launchVacationSchema, { accrualPeriodId: '', startDate: '', endDate: '', cashBonusDays: '0' });
  const [formError, setFormError] = useState<string | null>(null);
  const request = useApiMutation((api, body: { accrualPeriodId: string; startDate: string; endDate: string; cashBonusDays: number }) => api.vacations.request(employeeId, body), {
    invalidates: [...MODULES],
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      await request.mutateAsync({ accrualPeriodId: v.accrualPeriodId, startDate: v.startDate, endDate: v.endDate, cashBonusDays: Number(v.cashBonusDays) });
      notify.success('Férias lançadas', 'O pedido fica aguardando decisão.');
      onDone();
    } catch (e) {
      // 409 FERIAS_*: a api explica a regra; a mensagem aparece acima do botão.
      setFormError(applyApiErrors(form, remapFields(asApiError(e), {})));
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} aria-label={COPY.launch} className="flex flex-col gap-4 rounded-card border border-dashed border-brand bg-tint/40 p-4">
      <Controller
        control={form.control}
        name="accrualPeriodId"
        render={({ field }) => (
          <SelectField
            label="Período aquisitivo"
            required
            value={field.value}
            onValueChange={field.onChange}
            options={periods.map((p) => ({ value: p.id, label: `${formatDate(p.startDate)} a ${formatDate(p.endDate)}` }))}
            error={errors.accrualPeriodId?.message}
          />
        )}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateInput label="Primeiro dia" required error={errors.startDate?.message} {...form.register('startDate')} />
        <DateInput label="Último dia" required error={errors.endDate?.message} {...form.register('endDate')} />
      </div>
      <TextInput label="Abono pecuniário (dias)" type="number" inputMode="numeric" min={0} max={10} hint="De 0 a 10 dias." error={errors.cashBonusDays?.message} {...form.register('cashBonusDays')} />
      {formError && <FormAlert>{formError}</FormAlert>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={request.isPending} onClick={onDone}>Cancelar</Button>
        <Button type="submit" loading={request.isPending}>Registrar férias</Button>
      </div>
    </form>
  );
}
