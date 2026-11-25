'use client';
/** Mostra a senha provisória uma única vez. Ela vive só no estado de quem abre este diálogo e some ao fechar. */
import { Check, Copy, Key } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Fields';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/shadcn/alert-dialog';
import { TEMP_PASSWORD_WARNING } from '@/lib/labels/super-admin';
import { COPY } from './copy';

export interface PasswordReveal {
  tenantName: string;
  adminEmail: string;
  password: string;
}

export function TemporaryPasswordDialog({ reveal, onDone }: { reveal: PasswordReveal | null; onDone: () => void }) {
  // O corpo é remontado a cada exibição: a confirmação e o "copiado" nascem zerados.
  return (
    <AlertDialog open={reveal !== null}>
      {reveal && <Body reveal={reveal} onDone={onDone} />}
    </AlertDialog>
  );
}

function Body({ reveal, onDone }: { reveal: PasswordReveal; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const c = COPY.reveal;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.password);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };
  return (
    // Sem fechar por Esc: a pessoa precisa confirmar que guardou a senha.
    <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()} className="gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-lg font-bold"><Key size={20} aria-hidden />{c.title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{c.forTenant(reveal.tenantName, reveal.adminEmail)}</AlertDialogDescription>
      </AlertDialogHeader>
      <p role="alert" className="m-0 rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm font-semibold text-warn">{TEMP_PASSWORD_WARNING}</p>
      <code data-testid="temporary-password" className="block select-all break-all rounded-md border border-line bg-surface px-3 py-3 font-mono text-base">{reveal.password}</code>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" icon={copied === 'yes' ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />} onClick={() => void copy()}>
          {copied === 'yes' ? c.copied : c.copy}
        </Button>
        {copied === 'failed' && <span role="alert" className="text-sm text-danger">{c.copyFailed}</span>}
      </div>
      <CheckboxField label={c.done} checked={confirmed} onCheckedChange={setConfirmed} />
      <div className="flex justify-end">
        <Button disabled={!confirmed} onClick={onDone}>Fechar</Button>
      </div>
    </AlertDialogContent>
  );
}
