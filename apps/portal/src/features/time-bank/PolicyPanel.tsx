'use client';
/**
 * [SEM DESIGN] Regra do banco de horas do estabelecimento: consulta para rh e admin, edição só rh.
 * Sem regra, a api não lança nada. A api devolve a regra vigente hoje ou a próxima e decide as vigências.
 * Nenhum peso nem modalidade vem sugerido numa regra nova: quem escolhe é o RH.
 */
import { Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DateInput, SelectField, TextInput } from '@/components/ui/Fields';
import { KeyValueList } from '@/components/ui/KeyValueList';
import { notify } from '@/components/ui/notify';
import { QueryView } from '@/components/ui/QueryView';
import { SidePanel } from '@/components/ui/SidePanel';
import { Skeleton } from '@/components/ui/States';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import { TIME_BANK_MODALITIES, type SaveTimeBankPolicyBody, type TimeBankPolicy } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { can } from '@/lib/auth/permissions';
import { useClock } from '@/lib/clock-context';
import { formatDate, todayCivil } from '@/lib/format';
import { TIME_BANK_MODALITY } from '@/lib/labels';
import { useApiMutation, useApiQuery, useInvalidate } from '@/lib/query/hooks';
import { useSession } from '@/lib/session';
import { COPY, formatWeight, policyStartsLater, policyValidity } from './copy';
import { policyFormSchema } from './schemas';

const FORM_ID = 'time-bank-policy-form';

/** Quem monta o painel garante um estabelecimento escolhido e usa `key={establishment.id}`. */
export function PolicyPanel() {
  const { me, establishment } = useSession();
  const canEdit = can(me.role, 'timeBank.editPolicy');
  const today = todayCivil(useClock());
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const q = useApiQuery('timeBank', { policy: establishment.id }, (api, signal) => api.timeBank.policy(establishment.id, signal));

  const editButton = (label: string, variant: 'primary' | 'secondary') =>
    canEdit && (
      <div>
        <Button variant={variant} onClick={() => setEditing(true)}>{label}</Button>
      </div>
    );

  return (
    <Card as="section" className="flex flex-col gap-3 p-4">
      <h2 className="m-0 text-md font-bold tracking-[-0.01em]">{COPY.policyTitle}</h2>
      <QueryView query={q} what={COPY.policyWhat} loading={<Skeleton className="h-16 w-full" />}>
        {(policy) =>
          policy === null ? (
            <>
              <Notice title={COPY.policyMissingTitle} text={canEdit ? COPY.policyMissingText : `${COPY.policyMissingText} ${COPY.policyAskRh}`} />
              {editButton(COPY.policyDefine, 'primary')}
            </>
          ) : (
            <>
              {policy.validFrom > today && <Notice title={policyStartsLater(formatDate(policy.validFrom))} text={COPY.policyMissingText} />}
              <PolicyDetails policy={policy} />
              <p className="m-0 text-xs text-muted">{COPY.policyRecalcNote}</p>
              {editButton(COPY.policyChange, 'secondary')}
            </>
          )
        }
      </QueryView>
      {canEdit && (
        <SidePanel
          open={editing}
          onOpenChange={(o) => { if (!pending) setEditing(o); }}
          title={q.data ? COPY.policyChange : COPY.policyDefine}
          description={COPY.formDescription}
          footer={
            <>
              <Button variant="secondary" disabled={pending} onClick={() => setEditing(false)}>{COPY.formCancel}</Button>
              <Button type="submit" form={FORM_ID} loading={pending}>{COPY.formSave}</Button>
            </>
          }
        >
          {editing && <PolicyForm policy={q.data ?? null} today={today} onPending={setPending} onDone={() => setEditing(false)} />}
        </SidePanel>
      )}
    </Card>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div role="note" className="flex items-start gap-3 rounded-md bg-warn-bg px-4 py-3 text-sm text-warn">
      <Warning size={20} weight="fill" aria-hidden className="mt-px shrink-0" />
      <div className="flex flex-col gap-0.5">
        <span className="font-semibold">{title}</span>
        <span>{text}</span>
      </div>
    </div>
  );
}

function PolicyDetails({ policy }: { policy: TimeBankPolicy }) {
  return (
    <KeyValueList
      items={[
        { label: COPY.policyModality, value: TIME_BANK_MODALITY[policy.modality].label },
        { label: COPY.policySundayWeight, value: formatWeight(policy.sundayWeight) },
        { label: COPY.policyHolidayWeight, value: formatWeight(policy.holidayWeight) },
        {
          label: COPY.policyValidity,
          value: policyValidity(formatDate(policy.validFrom), policy.validTo ? formatDate(policy.validTo) : null),
        },
      ]}
    />
  );
}

function PolicyForm({ policy, today, onPending, onDone }: {
  policy: TimeBankPolicy | null;
  today: string;
  onPending: (v: boolean) => void;
  onDone: () => void;
}) {
  const { establishment } = useSession();
  // Início sugerido: hoje (nova vigência); se a regra registrada começa depois, a data dela (correção).
  const form = useZodForm(policyFormSchema, {
    modality: policy?.modality ?? '',
    sundayWeight: policy ? formatWeight(policy.sundayWeight) : '',
    holidayWeight: policy ? formatWeight(policy.holidayWeight) : '',
    validFrom: policy && policy.validFrom > today ? policy.validFrom : today,
  });
  const invalidate = useInvalidate();
  const save = useApiMutation((api, body: SaveTimeBankPolicyBody) => api.timeBank.savePolicy(establishment.id, body), { invalidates: ['timeBank'] });
  const [formError, setFormError] = useState<string | null>(null);
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (body) => {
    setFormError(null);
    onPending(true);
    try {
      await save.mutateAsync(body);
      notify.success(COPY.saved);
      onDone();
    } catch (e) {
      const err = asApiError(e);
      if (err.code === 'BANCO_REGRA_VIGENCIA') {
        form.setError('validFrom', { type: 'server', message: COPY.errorValidity });
        form.setFocus('validFrom');
        // Outra pessoa pode ter registrado uma regra: mostra a atual no painel.
        void invalidate('timeBank');
      } else {
        setFormError(applyApiErrors(form, err));
      }
    } finally {
      onPending(false);
    }
  });

  return (
    <form id={FORM_ID} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <Controller
        control={form.control}
        name="modality"
        render={({ field }) => (
          <SelectField
            label={COPY.policyModality}
            required
            value={field.value}
            onValueChange={field.onChange}
            options={TIME_BANK_MODALITIES.map((m) => ({ value: m, label: TIME_BANK_MODALITY[m].label }))}
            error={errors.modality?.message}
          />
        )}
      />
      <TextInput label={COPY.policySundayWeight} required inputMode="decimal" hint={COPY.formWeightHint} error={errors.sundayWeight?.message} {...form.register('sundayWeight')} />
      <TextInput label={COPY.policyHolidayWeight} required inputMode="decimal" hint={COPY.formWeightHint} error={errors.holidayWeight?.message} {...form.register('holidayWeight')} />
      <DateInput
        label={COPY.formValidFrom}
        required
        hint={policy ? COPY.formValidFromHint : COPY.formValidFromFirstHint}
        error={errors.validFrom?.message}
        {...form.register('validFrom')}
      />
      {formError && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{formError}</p>}
    </form>
  );
}
