'use client';
/**
 * Desligamento (rh): data + motivo (3 a 500). As marcações já registradas continuam guardadas (Portaria 671).
 * Erro da api aparece no diálogo, que continua aberto.
 */
import { WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { DateInput, TextArea } from '@/components/ui/Fields';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/shadcn/alert-dialog';
import type { Employee, TerminateEmployeeBody } from '@/lib/api/contracts';
import { asApiError } from '@/lib/api/errors';
import { COPY } from './copy';

export function TerminateDialog({ employee, defaultDate, onOpenChange, onConfirm }: {
  employee: Employee | null;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (employee: Employee, body: TerminateEmployeeBody) => Promise<void>;
}) {
  return (
    <AlertDialog open={employee !== null} onOpenChange={onOpenChange}>
      {employee && <Body employee={employee} defaultDate={defaultDate} onOpenChange={onOpenChange} onConfirm={onConfirm} />}
    </AlertDialog>
  );
}

function Body({ employee, defaultDate, onOpenChange, onConfirm }: {
  employee: Employee;
  defaultDate: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (employee: Employee, body: TerminateEmployeeBody) => Promise<void>;
}) {
  const [date, setDate] = useState(defaultDate);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && reason.trim().length >= 3 && reason.trim().length <= 500;

  const submit = async () => {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(employee, { terminationDate: date, reason: reason.trim() });
      onOpenChange(false);
    } catch (e) {
      setError(asApiError(e).message);
      setPending(false);
    }
  };

  return (
    <AlertDialogContent onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }} className="gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle className="text-lg font-bold">{`${COPY.terminate.title}: ${employee.name}`}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{COPY.terminate.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <DateInput label="Data do desligamento" required value={date} disabled={pending} min={employee.admissionDate} onChange={(e) => setDate(e.target.value)} />
      <TextArea
        label={COPY.terminate.reason} required rows={3} maxLength={500} value={reason} disabled={pending}
        hint={`Mínimo de 3 caracteres. ${reason.length}/500`} onChange={(e) => setReason(e.target.value)}
      />
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">
          <WarningCircle size={18} weight="fill" aria-hidden className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button variant="danger" disabled={!valid} loading={pending} onClick={() => void submit()}>{COPY.terminate.confirm}</Button>
      </div>
    </AlertDialogContent>
  );
}
