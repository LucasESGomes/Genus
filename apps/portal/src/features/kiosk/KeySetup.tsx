'use client';
import { ClipboardText, Plugs, WarningCircle } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/errors';
import type { KioskApi, KioskContext, KioskKeyStore } from '@/lib/api/kiosk';
import { COPY } from './copy';
import { BIG_BUTTON, KioskFrame } from './KioskFrame';

/** Primeira abertura (ou depois de "Desconectar"): pede a chave do aparelho e a valida chamando o contexto. */
export function KeySetup({ api, keyStore, notice, onConnected }: {
  api: KioskApi;
  keyStore: KioskKeyStore;
  notice?: string | null;
  onConnected: (context: KioskContext) => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const message = error ?? notice ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!key || busy) return;
    setBusy(true);
    setError(null);
    // O cliente lê a chave do storage a cada chamada: grava para validar e apaga se não servir.
    keyStore.set(key);
    try {
      const context = await api.context();
      setValue('');
      onConnected(context);
    } catch (err) {
      keyStore.clear();
      setError(err instanceof ApiError && err.kind === 'network' ? COPY.setup.network : COPY.setup.invalid);
      setBusy(false);
    }
  };

  const paste = async () => {
    try {
      setValue((await navigator.clipboard.readText()).trim());
    } catch {
      /* sem permissão para ler a área de transferência: a pessoa digita */
    }
  };

  return (
    <KioskFrame>
      <div className="flex flex-col items-center gap-3 pt-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tint"><Plugs size={32} className="text-brand" aria-hidden /></div>
        <h1 className="m-0 text-2xl font-bold">{COPY.setup.title}</h1>
        <p className="m-0 text-base text-muted text-pretty">{COPY.setup.text}</p>
      </div>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <label htmlFor="kiosk-key" className="text-base font-semibold">{COPY.setup.label}</label>
        <div className="flex gap-2">
          <input
            id="kiosk-key"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? 'kiosk-key-msg' : undefined}
            className="h-14 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-4 font-mono text-base"
          />
          <Button variant="secondary" className="h-14 shrink-0" icon={<ClipboardText size={22} aria-hidden />} onClick={() => void paste()}>{COPY.setup.paste}</Button>
        </div>
        {message && (
          <p id="kiosk-key-msg" role="alert" className="m-0 flex items-start gap-2 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-base text-danger">
            <WarningCircle size={22} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
            <span>{message}</span>
          </p>
        )}
        <Button type="submit" variant="primary" className={BIG_BUTTON} loading={busy} disabled={!value.trim()}>{COPY.setup.submit}</Button>
      </form>
    </KioskFrame>
  );
}
