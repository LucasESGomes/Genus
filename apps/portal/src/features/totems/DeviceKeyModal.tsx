'use client';
// Adaptado de visage/frontend/src/components/totem/DeviceKeyModal.tsx (fonte somente leitura)
//
// Diferença: na Visage a chave é colada no totem. No painel ela é MOSTRADA uma única vez (create e regenerar).
// A chave vive só no estado do componente pai: some do DOM ao concluir e nunca vai a storage, URL, log ou cache de consulta.
import { Check, Copy, Key } from '@phosphor-icons/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CheckboxField } from '@/components/ui/Fields';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/shadcn/alert-dialog';
import { COPY } from './copy';
import { OpenTotemLink } from './OpenTotemLink';
import type { KeyReveal } from './hooks';

export function DeviceKeyModal({ reveal, onDone }: { reveal: KeyReveal | null; onDone: () => void }) {
  // O corpo é remontado a cada exibição: a confirmação e o "copiado" nascem zerados.
  return (
    <AlertDialog open={reveal !== null}>
      {reveal && <KeyBody reveal={reveal} onDone={onDone} />}
    </AlertDialog>
  );
}

function KeyBody({ reveal, onDone }: { reveal: KeyReveal; onDone: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reveal.apiKey);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  return (
    // Sem fechar por Esc: a pessoa precisa confirmar que guardou a chave.
    <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()} className="gap-4">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-lg font-bold"><Key size={20} aria-hidden />{COPY.key.title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted">{COPY.key.description}</AlertDialogDescription>
      </AlertDialogHeader>
      <p className="m-0 text-sm font-semibold">{COPY.key.forDevice(reveal.deviceName)}</p>
      <code data-testid="device-key" className="block select-all break-all rounded-md border border-line bg-surface px-3 py-3 font-mono text-sm">{reveal.apiKey}</code>
      <p className="m-0 text-xs text-muted">{COPY.openTotem.keyHint}</p>
      <div className="flex flex-wrap items-center gap-3">
        <OpenTotemLink />
        <Button variant="secondary" icon={copied === 'yes' ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />} onClick={() => void copy()}>
          {copied === 'yes' ? COPY.key.copied : COPY.key.copy}
        </Button>
        {copied === 'failed' && <span role="alert" className="text-sm text-danger">{COPY.key.copyFailed}</span>}
      </div>
      <CheckboxField label={COPY.key.confirm} checked={confirmed} onCheckedChange={setConfirmed} />
      <div className="flex justify-end">
        <Button disabled={!confirmed} onClick={onDone}>{COPY.key.done}</Button>
      </div>
    </AlertDialogContent>
  );
}
