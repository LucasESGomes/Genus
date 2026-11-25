'use client';
import { WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextArea } from '@/components/ui/Fields';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/shadcn/alert-dialog';
import { asApiError } from '@/lib/api/errors';

interface ApproveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  noteLabel: string;
  confirmLabel: string;
  /** Se rejeitar, a mensagem aparece no diálogo e ele continua aberto. */
  onConfirm: (note: string | undefined) => Promise<void>;
}

/**
 * Confirmação de aprovação com observação OPCIONAL (3 a 500 caracteres quando preenchida).
 * O ConfirmDialog da fundação marca o motivo como obrigatório; aqui a observação é opcional.
 */
export function ApproveDialog({ open, onOpenChange, ...rest }: ApproveDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {open && <Body onOpenChange={onOpenChange} {...rest} />}
    </AlertDialog>
  );
}

function Body({ onOpenChange, title, description, noteLabel, confirmLabel, onConfirm }: Omit<ApproveDialogProps, 'open'>) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = note.trim();
  const noteError = trimmed.length > 0 && trimmed.length < 3 ? 'Escreva pelo menos 3 letras ou deixe em branco.' : undefined;

  const submit = async () => {
    if (pending || noteError) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm(trimmed || undefined);
      onOpenChange(false);
    } catch (e) {
      setError(asApiError(e).message);
      setPending(false);
    }
  };

  return (
    <AlertDialogContent className="gap-4" onEscapeKeyDown={(e) => { if (pending) e.preventDefault(); }}>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-lg font-bold">{title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <TextArea label={noteLabel} rows={3} maxLength={500} disabled={pending} value={note} error={noteError} onChange={(e) => setNote(e.target.value)} hint={`${note.length}/500`} />
      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">
          <WarningCircle size={18} weight="fill" aria-hidden className="mt-px shrink-0" />
          <span>{error}</span>
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button disabled={Boolean(noteError)} loading={pending} onClick={() => void submit()}>{confirmLabel}</Button>
      </div>
    </AlertDialogContent>
  );
}
