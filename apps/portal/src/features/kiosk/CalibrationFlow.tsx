'use client';
// Adaptado de visage/frontend/src/components/totem/CalibrationMode.tsx (fonte somente leitura)
//
// Assistente de ajuste do totem, iniciado pelo administrador no painel. Uma captura por vez, linguagem simples.
// As fotos ficam só em memória, saem do aparelho uma única vez (envio) e são apagadas ao enviar ou cancelar.
import { CheckCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { isKeyRejected, type KioskApi } from '@/lib/api/kiosk';
import { CaptureCamera } from './CaptureCamera';
import { COPY } from './copy';
import { StepIllustration, type StepArt } from './illustrations';
import { BIG_BUTTON, KioskFrame } from './KioskFrame';

interface StepDef {
  id: 'p1' | 'p2' | 'others' | 'screen';
  count: number;
  art: StepArt;
}

const STEPS: readonly StepDef[] = [
  { id: 'p1', count: 3, art: 'one' },
  { id: 'p2', count: 3, art: 'two' },
  { id: 'others', count: 3, art: 'many' },
  { id: 'screen', count: 2, art: 'phone' },
];

type Shots = Record<StepDef['id'], Blob[]>;
const EMPTY: Shots = { p1: [], p2: [], others: [], screen: [] };

type Phase =
  | { kind: 'intro' }
  | { kind: 'stepIntro'; step: number }
  | { kind: 'capture'; step: number }
  | { kind: 'review' }
  | { kind: 'sending' }
  | { kind: 'failed' }
  | { kind: 'done' };

/** multipart do contrato: `sessionId`, `genuine` (p1_1.jpg, p1_2.jpg, p2_1.jpg…), `impostor`, `attack`. */
export function buildCalibrationForm(sessionId: string, shots: Shots): FormData {
  const form = new FormData();
  form.append('sessionId', sessionId);
  (['p1', 'p2'] as const).forEach((id) => shots[id].forEach((b, i) => form.append('genuine', b, `${id}_${i + 1}.jpg`)));
  shots.others.forEach((b, i) => form.append('impostor', b, `i_${i + 1}.jpg`));
  shots.screen.forEach((b, i) => form.append('attack', b, `a_${i + 1}.jpg`));
  return form;
}

export function CalibrationFlow({ api, sessionId, onSubmitted, onCancel, onKeyRejected }: {
  api: KioskApi;
  sessionId: string;
  /** Enviado (ou concluído): o app não volta a abrir esta sessão. */
  onSubmitted: () => void;
  /** "Agora não" ou cancelar: o app não volta a abrir esta sessão neste aparelho até recarregar. */
  onCancel: () => void;
  onKeyRejected: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [shots, setShots] = useState<Shots>(EMPTY);
  const shotsRef = useRef<Shots>(EMPTY);
  shotsRef.current = shots;

  const wipe = useCallback(() => setShots(EMPTY), []);
  const cancel = useCallback(() => {
    wipe();
    onCancel();
  }, [wipe, onCancel]);

  const capture = (stepIndex: number, blob: Blob) => {
    const def = STEPS[stepIndex];
    if (!def) return;
    const next = { ...shotsRef.current, [def.id]: [...shotsRef.current[def.id], blob] };
    setShots(next);
    if (next[def.id].length >= def.count) {
      setPhase(stepIndex + 1 < STEPS.length ? { kind: 'stepIntro', step: stepIndex + 1 } : { kind: 'review' });
    }
  };

  const send = async () => {
    setPhase({ kind: 'sending' });
    try {
      await api.submitCalibration(buildCalibrationForm(sessionId, shotsRef.current));
      wipe();
      setPhase({ kind: 'done' });
    } catch (e) {
      if (isKeyRejected(e)) {
        wipe();
        return onKeyRejected();
      }
      setPhase({ kind: 'failed' });
    }
  };

  // Sair da tela por qualquer caminho descarta as fotos (a referência some junto com o componente).
  useEffect(() => () => void (shotsRef.current = EMPTY), []);

  const cancelButton = <Button variant="ghost" className="h-12 text-base" onClick={cancel}>{COPY.calibration.cancel}</Button>;

  if (phase.kind === 'intro') {
    return (
      <KioskFrame action={cancelButton}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <StepIllustration art="camera" />
          <h1 className="m-0 text-2xl font-bold">{COPY.calibration.introTitle}</h1>
          <p className="m-0 text-lg text-pretty">{COPY.calibration.introText}</p>
          <Button variant="primary" className={BIG_BUTTON} onClick={() => setPhase({ kind: 'stepIntro', step: 0 })}>{COPY.calibration.start}</Button>
          <Button variant="secondary" className={BIG_BUTTON} onClick={cancel}>{COPY.calibration.later}</Button>
        </div>
      </KioskFrame>
    );
  }

  if (phase.kind === 'stepIntro' || phase.kind === 'capture') {
    const def = STEPS[phase.step];
    const text = COPY.calibration.steps[phase.step];
    if (!def || !text) return null;
    if (phase.kind === 'stepIntro') {
      return (
        <KioskFrame action={cancelButton}>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <StepIllustration art={def.art} />
            <h1 className="m-0 text-2xl font-bold text-pretty">{text.title}</h1>
            <p className="m-0 text-lg text-pretty">{text.text}</p>
            <Button variant="primary" className={BIG_BUTTON} onClick={() => setPhase({ kind: 'capture', step: phase.step })}>{COPY.calibration.next}</Button>
          </div>
        </KioskFrame>
      );
    }
    const taken = shots[def.id].length;
    return (
      <KioskFrame action={cancelButton}>
        <div className="flex flex-col gap-1 text-center">
          <h1 className="m-0 text-xl font-bold text-pretty">{text.title}</h1>
          <p role="status" className="m-0 text-lg font-semibold">{COPY.calibration.counter(Math.min(taken + 1, def.count), def.count)}</p>
        </div>
        <CaptureCamera onCapture={(b) => capture(phase.step, b)} />
      </KioskFrame>
    );
  }

  if (phase.kind === 'review' || phase.kind === 'failed') {
    const lines = COPY.calibration.review(shots.p1.length, shots.p2.length, shots.others.length, shots.screen.length);
    return (
      <KioskFrame action={cancelButton}>
        <h1 className="m-0 text-center text-2xl font-bold">{COPY.calibration.reviewTitle}</h1>
        <ul className="m-0 flex list-none flex-col gap-2 rounded-card border border-line bg-white p-4 text-lg">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {phase.kind === 'failed' && <p role="alert" className="m-0 rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-base text-danger">{COPY.calibration.failedSend}</p>}
        <Button variant="primary" className={BIG_BUTTON} onClick={() => void send()}>{COPY.calibration.send}</Button>
      </KioskFrame>
    );
  }

  if (phase.kind === 'sending') {
    return (
      <KioskFrame>
        <div role="status" aria-busy="true" className="flex flex-1 items-center justify-center text-center">
          <h1 className="m-0 text-2xl font-bold">{COPY.calibration.sending}</h1>
        </div>
      </KioskFrame>
    );
  }

  return (
    <KioskFrame>
      <div role="status" className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-good-bg"><CheckCircle size={64} weight="fill" className="text-good" aria-hidden /></div>
        <h1 className="m-0 text-3xl font-bold">{COPY.calibration.doneTitle}</h1>
        <p className="m-0 text-xl text-pretty">{COPY.calibration.doneText}</p>
        <Button variant="primary" className={BIG_BUTTON} onClick={onSubmitted}>{COPY.calibration.doneButton}</Button>
      </div>
    </KioskFrame>
  );
}
