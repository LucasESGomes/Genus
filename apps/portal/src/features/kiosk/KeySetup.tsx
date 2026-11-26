'use client';
// Adaptado de visage/frontend/src/components/totem/DeviceKeyModal.tsx (fonte somente leitura)
import { ClipboardText, Key, WarningCircle } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api/errors';
import type { KioskApi, KioskContext, KioskKeyStore } from '@/lib/api/kiosk';
import { COPY } from './copy';
import { KioskHome } from './KioskHome';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './ui';

/** Primeira abertura (ou depois de "Desconectar"): janela sobre o descanso pede a chave e a valida chamando o contexto. */
export function KeySetup({ api, keyStore, notice, onConnected }: {
  api: KioskApi;
  keyStore: KioskKeyStore;
  notice?: string | null;
  onConnected: (context: KioskContext) => void;
}) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const message = error ?? notice ?? null;
  const show = () => setOpen(true);

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
    <>
      <div inert={open}>
        <KioskHome onPunch={show} onEnroll={show} onSetup={show} />
      </div>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-brand-active/60 p-4 backdrop-blur-sm">
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kiosk-key-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
            className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-xl"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-tint text-brand"><Key size={24} aria-hidden /></span>
            <h2 id="kiosk-key-title" className="m-0 mt-4 text-xl font-semibold tracking-tight">{COPY.setup.title}</h2>
            <p className="m-0 mt-1 text-sm text-pretty text-muted">{COPY.setup.text}</p>
            <form onSubmit={(e) => void submit(e)} className="mt-5 flex flex-col gap-3">
              <label htmlFor="kiosk-key" className="text-sm font-semibold">{COPY.setup.label}</label>
              <div className="flex gap-2">
                <input
                  id="kiosk-key"
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={message ? true : undefined}
                  aria-describedby={message ? 'kiosk-key-msg' : undefined}
                  className="h-14 min-w-0 flex-1 rounded-xl border border-line-strong bg-white px-4 font-mono text-base shadow-xs focus:border-brand focus:shadow-focus focus:outline-none"
                />
                <button type="button" onClick={() => void paste()} className="flex h-14 shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-white px-4 font-semibold hover:bg-surface">
                  <ClipboardText size={20} aria-hidden />
                  {COPY.setup.paste}
                </button>
              </div>
              {message && (
                <p id="kiosk-key-msg" role="alert" className="m-0 flex items-start gap-2 rounded-lg border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">
                  <WarningCircle size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
                  <span>{message}</span>
                </p>
              )}
              <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row">
                <button type="button" onClick={() => setOpen(false)} className={SECONDARY_BUTTON}>{COPY.setup.cancel}</button>
                <button type="submit" disabled={!value.trim() || busy} aria-busy={busy || undefined} className={PRIMARY_BUTTON}>{COPY.setup.submit}</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
