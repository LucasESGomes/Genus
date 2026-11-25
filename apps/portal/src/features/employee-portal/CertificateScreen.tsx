'use client';
import { Camera, CheckCircle, FirstAidKit, Image as ImageIcon } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { Controller } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { DateInput, FileInput, TextInput } from '@/components/ui/Fields';
import { QueryView } from '@/components/ui/QueryView';
import { Skeleton } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { applyApiErrors, useZodForm } from '@/components/ui/useZodForm';
import type { MyCertificate } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { DEFAULT_TZ, formatDate, formatInstant, plural } from '@/lib/format';
import { CERTIFICATE_STATUS } from '@/lib/labels';
import { CERTIFICATE_ACCEPT, COPY, MAX_CERTIFICATE_BYTES } from './copy';
import { useMyCertificates, useSubmitCertificate } from './hooks';
import { ChoiceGroup, FormAlert, LoadingBlock, remapFields } from './parts';
import { PortalFrame } from './PortalFrame';
import { certificateSchema } from './schemas';

/** Atestado: enviar (foto ou arquivo) e acompanhar. Aqui nunca aparece CID, análise, risco nem texto lido do arquivo. */
export function CertificateScreen() {
  const [protocol, setProtocol] = useState<string | null>(null);
  if (protocol !== null) return <SentState protocol={protocol} onAnother={() => setProtocol(null)} />;
  return (
    <PortalFrame title="Enviar atestado" subtitle="Envie assim que puder, com o atestado inteiro na foto.">
      <CertificateForm onSent={setProtocol} />
      <MyCertificates />
    </PortalFrame>
  );
}

function SentState({ protocol, onAnother }: { protocol: string; onAnother: () => void }) {
  return (
    <PortalFrame title="Atestado enviado">
      <div role="status" className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <div className="flex size-[72px] items-center justify-center rounded-full bg-tint"><CheckCircle size={36} className="text-brand" aria-hidden /></div>
        <p className="m-0 text-muted text-pretty">O RH vai analisar e a resposta aparece aqui, em Atestado. Guarde o original em papel.</p>
        <span className="rounded-md border border-line bg-surface px-3 py-1 text-sm tabular-nums text-ink-2">Protocolo nº {protocol}</span>
        <Link href="/me" className="mt-2 flex min-h-14 w-full items-center justify-center rounded-full bg-brand px-5 font-bold text-white hover:bg-brand-hover">Voltar ao início</Link>
        <Button variant="secondary" className="min-h-12 w-full" onClick={onAnother}>Enviar outro atestado</Button>
      </div>
    </PortalFrame>
  );
}

const UNIT_OPTIONS = [{ value: 'dias', label: 'Dias' }, { value: 'horas', label: 'Horas' }];

function CertificateForm({ onSent }: { onSent: (protocol: string) => void }) {
  const form = useZodForm(certificateSchema, { startDate: '', unit: 'dias', amount: '', doctorName: '', doctorCrm: '', doctorCrmUf: '' });
  const [camera, setCamera] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const submitCertificate = useSubmitCertificate();
  const { errors } = form.formState;
  const unit = form.watch('unit');

  const submit = form.handleSubmit(async (v) => {
    setFormError(null);
    try {
      // Dias OU horas: só um dos dois vai para a api.
      const created = await submitCertificate.mutateAsync({
        file: v.file,
        startDate: v.startDate,
        ...(v.unit === 'dias' ? { days: Number(v.amount) } : { hours: Number(v.amount) }),
        ...(v.doctorName ? { doctorName: v.doctorName } : {}),
        ...(v.doctorCrm ? { doctorCrm: v.doctorCrm } : {}),
        ...(v.doctorCrmUf ? { doctorCrmUf: v.doctorCrmUf } : {}),
      });
      onSent(created.id);
    } catch (e) {
      const general = applyApiErrors(form, remapFields(asApiError(e), { days: 'amount', hours: 'amount' }));
      if (general) setFormError(general);
    }
  });

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-label="Enviar atestado">
      <div className="flex gap-2" role="group" aria-label="Como enviar o arquivo">
        <Button variant="secondary" aria-pressed={camera} className={`min-h-12 flex-1 ${camera ? 'border-brand bg-tint' : ''}`} icon={<Camera size={20} aria-hidden />} onClick={() => setCamera(true)}>Fotografar</Button>
        <Button variant="secondary" aria-pressed={!camera} className={`min-h-12 flex-1 ${camera ? '' : 'border-brand bg-tint'}`} icon={<ImageIcon size={20} aria-hidden />} onClick={() => setCamera(false)}>Galeria ou PDF</Button>
      </div>
      <FileInput
        key={camera ? 'camera' : 'galeria'}
        label="Foto ou arquivo do atestado"
        required
        accept={CERTIFICATE_ACCEPT}
        maxBytes={MAX_CERTIFICATE_BYTES}
        capture={camera ? 'environment' : undefined}
        error={errors.file?.message}
        onFile={(file) => {
          if (file) form.setValue('file', file, { shouldValidate: form.formState.isSubmitted });
          else form.resetField('file');
        }}
      />
      <DateInput label="Primeiro dia de afastamento" required className="h-12" error={errors.startDate?.message} {...form.register('startDate')} />
      <Controller
        control={form.control}
        name="unit"
        render={({ field }) => <ChoiceGroup legend="O atestado vale por" value={field.value} onValueChange={(v) => field.onChange(v)} options={UNIT_OPTIONS} />}
      />
      <TextInput
        label={unit === 'dias' ? 'Quantos dias' : 'Quantas horas'}
        required
        type="number"
        inputMode="numeric"
        min={1}
        max={unit === 'dias' ? 365 : 24}
        className="h-12"
        hint={unit === 'dias' ? 'De 1 a 365 dias.' : 'De 1 a 24 horas.'}
        error={errors.amount?.message}
        {...form.register('amount')}
      />
      <details className="rounded-card border border-line">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold">Dados do médico (opcional)</summary>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <TextInput label="Nome do médico" className="h-12" autoComplete="off" error={errors.doctorName?.message} {...form.register('doctorName')} />
          <TextInput label="CRM" className="h-12" inputMode="numeric" autoComplete="off" hint="Só os números." error={errors.doctorCrm?.message} {...form.register('doctorCrm')} />
          <TextInput label="Estado do CRM" className="h-12" maxLength={2} autoComplete="off" hint="Sigla, como SP." error={errors.doctorCrmUf?.message} {...form.register('doctorCrmUf')} />
        </div>
      </details>
      {formError && <FormAlert>{formError}</FormAlert>}
      <Button type="submit" loading={submitCertificate.isPending} className="min-h-14 w-full text-base font-bold">{COPY.sendCertificate}</Button>
    </form>
  );
}

/** Lista só o que o colaborador pode ver: período, quando enviou, situação e o motivo da decisão. */
function MyCertificates() {
  const q = useMyCertificates();
  return (
    <section aria-labelledby="meus-atestados" className="flex flex-col gap-2">
      <h2 id="meus-atestados" className="m-0 text-base font-bold">Meus atestados</h2>
      <QueryView
        query={q}
        what="seus atestados"
        loading={<LoadingBlock><Skeleton className="h-16 rounded-card" /></LoadingBlock>}
        isEmpty={(items) => items.length === 0}
        empty={<p className="m-0 text-sm text-muted">Você ainda não enviou atestados.</p>}
      >
        {(items) => (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((c) => <CertificateItem key={c.id} c={c} />)}
          </ul>
        )}
      </QueryView>
    </section>
  );
}

function CertificateItem({ c }: { c: MyCertificate }) {
  const status = CERTIFICATE_STATUS[c.status];
  const length = c.days !== null ? plural(c.days, 'dia', 'dias') : c.hours !== null ? plural(c.hours, 'hora', 'horas') : '';
  return (
    <li className="flex flex-col gap-1.5 rounded-card border border-line px-4 py-3.5">
      <div className="flex items-center gap-3">
        <FirstAidKit size={22} aria-hidden className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">A partir de {formatDate(c.startDate)}{length && ` · ${length}`}</span>
          <span className="text-sm text-muted">Enviado em {formatInstant(c.sentAt, DEFAULT_TZ, 'dd/MM/yyyy')}</span>
        </div>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      {c.decisionReason && <p className="m-0 text-sm text-ink-2">Motivo: {c.decisionReason}</p>}
    </li>
  );
}
