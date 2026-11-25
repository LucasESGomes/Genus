'use client';
import { WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { asApiError } from '@/lib/api/errors';
import { Button } from './Button';
import { TextArea, TextInput } from './Fields';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from './shadcn/alert-dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /** Pede um motivo (obrigatório, com pelo menos `min` caracteres, padrão 1). */
  reason?: { label: string; min?: number; max?: number };
  /** Texto que a pessoa precisa digitar igual para liberar o botão. */
  typeToConfirm?: string;
  /** Se rejeitar, a mensagem da api aparece no diálogo e ele continua aberto. */
  onConfirm: (reason?: string) => Promise<void>;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onOpenChange } = props;
  // O corpo é remontado a cada abertura: motivo, texto digitado e erro nascem zerados.
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open && <ConfirmBody {...props} />}
    </AlertDialog>
  );
}

function ConfirmBody({ onOpenChange, title, description, confirmLabel, tone = 'default', reason, typeToConfirm, onConfirm }: ConfirmDialogProps) {
  const [text, setText] = useState('');
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const min = reason ? (reason.min ?? 1) : 0;
  const reasonOk = !reason || text.trim().length >= min;
  const typedOk = typeToConfirm === undefined || typed.trim() === typeToConfirm;
  const canConfirm = reasonOk && typedOk && !pending;

  const submit = async () => {
    if (!canConfirm) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(reason ? text.trim() : undefined);
      onOpenChange(false);
    } catch (e) {
      setError(asApiError(e).message);
      setPending(false);
    }
  };

  return (
    <AlertDialogContent
      onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}
      className="gap-4"
    >
      <AlertDialogHeader>
        <AlertDialogTitle className="text-lg font-bold">{title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{description}</AlertDialogDescription>
      </AlertDialogHeader>

      {reason && (
        <TextArea
          label={reason.label}
          required
          value={text}
          maxLength={reason.max}
          rows={3}
          disabled={pending}
          onChange={(e) => setText(e.target.value)}
          hint={[min > 1 ? `Mínimo de ${min} caracteres.` : null, reason.max ? `${text.length}/${reason.max}` : null].filter(Boolean).join(' ') || undefined}
        />
      )}
      {typeToConfirm !== undefined && (
        <TextInput
          label={`Digite “${typeToConfirm}” para confirmar`}
          required
          value={typed}
          autoComplete="off"
          disabled={pending}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">
          <WarningCircle size={18} weight="fill" aria-hidden className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} disabled={!canConfirm} loading={pending} onClick={() => void submit()}>
          {confirmLabel}
        </Button>
      </div>
    </AlertDialogContent>
  );
}
