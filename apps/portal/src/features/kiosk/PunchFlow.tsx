'use client';
// Adaptado de visage/frontend/src/components/totem/TotemStage.tsx (fonte somente leitura)
//
// Registrar ponto: câmera → foto → coletor → resultado por alguns segundos → início.
// Portaria 671: o totem nunca fala em "proibido" nem bloqueia; as orientações são só sobre a foto.
import { CheckCircle, UserFocus } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api/errors';
import { isKeyRejected, type KioskApi, type PunchResult } from '@/lib/api/kiosk';
import { formatTime } from '@/lib/format';
import { CaptureCamera } from './CaptureCamera';
import { COPY } from './copy';
import { BIG_BUTTON, KioskFrame } from './KioskFrame';

export const SUCCESS_MS = 4000;
export const GUIDANCE_MS = 8000;

type Phase = { kind: 'camera' } | { kind: 'sending' } | { kind: 'result'; result: PunchResult } | { kind: 'error'; message: string };

export function PunchFlow({ api, onDone, onKeyRejected }: { api: KioskApi; onDone: () => void; onKeyRejected: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // O resultado aparece por alguns segundos e a tela volta sozinha ao início.
  useEffect(() => {
    if (phase.kind !== 'result') return;
    const ms = phase.result.outcome === 'registered' ? SUCCESS_MS : GUIDANCE_MS;
    const id = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(id);
  }, [phase, onDone]);

  const send = useCallback(
    async (image: Blob) => {
      setPhase({ kind: 'sending' });
      try {
        const result = await api.punch(image);
        if (alive.current) setPhase({ kind: 'result', result });
      } catch (e) {
        if (!alive.current) return;
        if (isKeyRejected(e)) return onKeyRejected();
        setPhase({ kind: 'error', message: e instanceof ApiError && e.kind === 'network' ? COPY.punch.network : COPY.punch.generic });
      }
    },
    [api, onKeyRejected],
  );

  if (phase.kind === 'result') {
    return <ResultScreen result={phase.result} onRetry={() => setPhase({ kind: 'camera' })} onDone={onDone} />;
  }
  if (phase.kind === 'error') {
    return (
      <KioskFrame>
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <h1 className="m-0 text-2xl font-bold">{phase.message}</h1>
          <Button variant="primary" className={BIG_BUTTON} onClick={() => setPhase({ kind: 'camera' })}>{COPY.punch.again}</Button>
          <Button variant="secondary" className={BIG_BUTTON} onClick={onDone}>{COPY.punch.home}</Button>
        </div>
      </KioskFrame>
    );
  }
  const sending = phase.kind === 'sending';
  return (
    <KioskFrame action={<Button variant="ghost" className="h-12 text-base" onClick={onDone}>{COPY.enroll.cancel}</Button>}>
      <div className="flex flex-col gap-1 text-center">
        <h1 className="m-0 text-2xl font-bold">{COPY.punch.title}</h1>
        <p role="status" className="m-0 text-base text-muted">{sending ? COPY.punch.sending : COPY.punch.lookAtCamera}</p>
      </div>
      <CaptureCamera auto busy={sending} onCapture={(b) => void send(b)} />
    </KioskFrame>
  );
}

function ResultScreen({ result, onRetry, onDone }: { result: PunchResult; onRetry: () => void; onDone: () => void }) {
  if (result.outcome === 'registered') {
    const name = result.employeeFirstName?.trim();
    const time = formatTime(result.markedAt);
    return (
      <KioskFrame>
        <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-good-bg"><CheckCircle size={64} weight="fill" className="text-good" aria-hidden /></div>
          <h1 className="m-0 text-3xl font-bold">{COPY.punch.success}</h1>
          <p className="m-0 text-2xl font-semibold">{name ? `${name} · ${time}` : time}</p>
        </div>
      </KioskFrame>
    );
  }
  return (
    <KioskFrame>
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-warn-bg"><UserFocus size={56} className="text-warn" aria-hidden /></div>
        <h1 className="m-0 text-2xl font-bold text-pretty">{COPY.fallback[result.reason]}</h1>
        <Button variant="primary" className={BIG_BUTTON} onClick={onRetry}>{COPY.punch.again}</Button>
        <Button variant="secondary" className={BIG_BUTTON} onClick={onDone}>{COPY.punch.home}</Button>
      </div>
    </KioskFrame>
  );
}
