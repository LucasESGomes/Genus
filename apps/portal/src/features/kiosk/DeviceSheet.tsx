'use client';
// Adaptado de visage/frontend/src/components/totem/DeviceKeyModal.tsx (fonte somente leitura)
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog';
import type { KioskContext } from '@/lib/api/kiosk';
import { useMocks } from '@/lib/api/mocks/runtime';
import { kioskMockControls } from '@/lib/api/mocks/kiosk';
import { COPY } from './copy';

/** "Aparelho": o que este totem é, só o começo da chave, e "Desconectar". A chave inteira nunca aparece. */
export function DeviceSheet({ open, onOpenChange, context, prefix, onDisconnect }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: KioskContext | undefined;
  prefix: string;
  onDisconnect: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [, bump] = useState(0);
  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{COPY.sheet.title}</DialogTitle>
            <DialogDescription className="sr-only">Dados deste aparelho</DialogDescription>
          </DialogHeader>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
            <dt className="text-muted">{COPY.sheet.device}</dt>
            <dd className="m-0 font-semibold">{context?.device.name ?? '—'}</dd>
            <dt className="text-muted">{COPY.sheet.establishment}</dt>
            <dd className="m-0 font-semibold">{context?.establishment.name ?? '—'}</dd>
            <dt className="text-muted">{COPY.sheet.key}</dt>
            <dd className="m-0 font-mono font-semibold">{prefix}…</dd>
          </dl>
          {useMocks() && (
            // Só em modo mock: simula o painel pedindo ajuste e o resultado do reconhecimento.
            <div className="flex flex-col gap-2 rounded-md border border-dashed border-line-strong p-3 text-sm">
              <span className="font-semibold">Somente demonstração</span>
              <Button size="sm" variant="secondary" onClick={() => { kioskMockControls.calibrationWaiting = true; bump((n) => n + 1); }}>Pedir ajuste do totem</Button>
              <Button size="sm" variant="secondary" onClick={() => { kioskMockControls.punchOutcome = kioskMockControls.punchOutcome === 'registered' ? 'not_recognized' : 'registered'; bump((n) => n + 1); }}>
                {`Próximo ponto: ${kioskMockControls.punchOutcome === 'registered' ? 'reconhece' : 'não reconhece'}`}
              </Button>
            </div>
          )}
          <Button variant="danger" className="h-14 w-full text-lg" onClick={() => setConfirming(true)}>{COPY.sheet.disconnect}</Button>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={open && confirming}
        onOpenChange={(o) => { if (!o) setConfirming(false); }}
        title={COPY.sheet.confirmTitle}
        description={COPY.sheet.confirmText}
        confirmLabel={COPY.sheet.confirm}
        tone="danger"
        onConfirm={async () => {
          setConfirming(false);
          onDisconnect();
        }}
      />
    </>
  );
}
