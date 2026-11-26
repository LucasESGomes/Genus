'use client';
// Adaptado de visage/frontend/src/components/totem/TotemCamera.tsx (fonte somente leitura)
//
// Registrar ponto: a pessoa toca no botão → câmera → foto → coletor → desfecho por alguns segundos → início.
// Uma batida por toque: o totem nunca fica registrando quem passa na frente (a marcação não se apaga).
// A foto automática só dispara com detector nativo e rosto parado; "Tirar foto" existe sempre.
// Portaria 671: o totem nunca fala em "proibido" nem bloqueia; as orientações são só sobre a foto.
import { Camera, Timer, UserFocus } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFaceDetection } from '@/features/totems/camera/useFaceDetection';
import { useTotemCamera } from '@/features/totems/camera/useTotemCamera';
import { ApiError } from '@/lib/api/errors';
import { isKeyRejected, type FallbackReason, type KioskApi, type PunchResult } from '@/lib/api/kiosk';
import { formatTime } from '@/lib/format';
import { framingFromFaceRatio, isStill, nextStillCount, STILL_TICKS_TO_CAPTURE, type FaceBox, type Framing } from './captureGuide';
import { COPY } from './copy';
import { playError, playSuccess } from './sounds';
import { cameraFailed, FaceGuide, FlashlightButton, FlashlightOverlay, STAGE_BUTTON, StageBottom, StageError, StageHeader, StageResultOverlay, StageShell, StageVideo, type GuideState, type StageResult } from './TotemStage';

export const SUCCESS_MS = 4000;
export const GUIDANCE_MS = 8000;
/** Sem foto neste tempo, o totem volta ao início. */
const IDLE_TIMEOUT_S = 30;
const DETECT_INTERVAL_MS = 400;
const BLINK_BEFORE_OVERLAY_MS = 550;
const PHRASE_MS = 2200;

const REFUSALS: readonly FallbackReason[] = ['not_recognized', 'liveness_failed'];

type Phase = { kind: 'camera' } | { kind: 'sending' } | { kind: 'result'; result: PunchResult } | { kind: 'error'; message: string };
type FaceState = Framing | 'none' | 'multiple';

function present(phase: Phase): StageResult | null {
  if (phase.kind === 'error') return { kind: 'error', title: phase.message };
  if (phase.kind !== 'result') return null;
  const { result } = phase;
  if (result.outcome === 'registered') {
    const name = result.employeeFirstName?.trim();
    const time = formatTime(result.markedAt);
    return { kind: 'success', title: COPY.punch.success, message: name ? `${name} · ${time}` : time };
  }
  return { kind: REFUSALS.includes(result.reason) ? 'error' : 'warning', title: COPY.fallback[result.reason] };
}

export function PunchFlow({ api, onDone, onKeyRejected }: { api: KioskApi; onDone: () => void; onKeyRejected: () => void }) {
  const camera = useTotemCamera();
  const detection = useFaceDetection();
  const { start, stop, status, captureJpeg } = camera;
  const [phase, setPhase] = useState<Phase>({ kind: 'camera' });
  const [face, setFace] = useState<FaceState>('none');
  const [countdown, setCountdown] = useState(IDLE_TIMEOUT_S);
  const [phrase, setPhrase] = useState(0);
  const [overlayShown, setOverlayShown] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const alive = useRef(true);
  const capturing = useRef(false);
  const stillCount = useRef(0);
  const prevBox = useRef<FaceBox | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  // O desfecho aparece por alguns segundos e a tela volta sozinha ao início.
  useEffect(() => {
    if (phase.kind !== 'result') return;
    const ms = phase.result.outcome === 'registered' ? SUCCESS_MS : GUIDANCE_MS;
    const id = window.setTimeout(onDone, ms);
    return () => window.clearTimeout(id);
  }, [phase, onDone]);

  // A guia pisca na cor do desfecho e só então o painel verde/vermelho toma a tela.
  useEffect(() => {
    setOverlayShown(false);
    const kind = present(phase)?.kind;
    if (!kind || kind === 'warning') return;
    if (kind === 'success') playSuccess();
    else playError();
    const id = window.setTimeout(() => setOverlayShown(true), BLINK_BEFORE_OVERLAY_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  const failed = cameraFailed(status);
  const waiting = phase.kind === 'camera' && !failed;
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => setCountdown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(id);
  }, [waiting]);
  useEffect(() => {
    if (waiting && countdown === 0) onDone();
  }, [waiting, countdown, onDone]);

  const sending = phase.kind === 'sending';
  useEffect(() => {
    if (!sending) return setPhrase(0);
    const id = window.setInterval(() => setPhrase((p) => (p + 1) % COPY.punch.phrases.length), PHRASE_MS);
    return () => window.clearInterval(id);
  }, [sending]);

  const capture = useCallback(async () => {
    if (capturing.current || phaseRef.current.kind !== 'camera') return;
    capturing.current = true;
    try {
      const image = await captureJpeg(960, 0.85);
      if (!image || !alive.current) return;
      setPhase({ kind: 'sending' });
      try {
        const result = await api.punch(image);
        if (alive.current) setPhase({ kind: 'result', result });
      } catch (e) {
        if (!alive.current) return;
        if (isKeyRejected(e)) return onKeyRejected();
        setPhase({ kind: 'error', message: e instanceof ApiError && e.kind === 'network' ? COPY.punch.network : COPY.punch.generic });
      }
    } finally {
      capturing.current = false;
    }
  }, [api, captureJpeg, onKeyRejected]);

  const tick = async () => {
    const video = camera.videoRef.current;
    if (!video || !video.videoWidth || capturing.current || phaseRef.current.kind !== 'camera') return;
    const faces = await detection.detect(video);
    if (faces === null) return;
    const [only] = faces;
    if (!only || faces.length > 1) {
      prevBox.current = null;
      stillCount.current = 0;
      return setFace(only ? 'multiple' : 'none');
    }
    const framing = framingFromFaceRatio(only.width / video.videoWidth);
    setFace(framing);
    stillCount.current = nextStillCount(stillCount.current, framing === 'good', isStill(prevBox.current, only, video.videoWidth));
    prevBox.current = only;
    if (stillCount.current >= STILL_TICKS_TO_CAPTURE) {
      stillCount.current = 0;
      void capture();
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  const native = detection.supported === true;
  useEffect(() => {
    if (status !== 'ready' || !native) return;
    const id = window.setInterval(() => void tickRef.current(), DETECT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, native]);

  const retry = () => {
    stillCount.current = 0;
    prevBox.current = null;
    setFace('none');
    setCountdown(IDLE_TIMEOUT_S);
    setPhase({ kind: 'camera' });
  };

  const result = present(phase);
  const overlay = result && overlayShown && result.kind !== 'warning' ? result : null;
  const guide: GuideState = result ? result.kind : sending ? 'processing' : face === 'multiple' ? 'warning' : face === 'none' ? 'neutral' : 'detecting';
  const scale = face === 'far' ? 0.88 : face === 'close' ? 1.12 : 1;
  const hint = !native
    ? { title: COPY.punch.position, subtitle: COPY.camera.hints.manual }
    : face === 'none'
      ? { title: COPY.punch.position, subtitle: COPY.stage.center }
      : face === 'good'
        ? { title: COPY.camera.hints.good, subtitle: COPY.punch.automatic }
        : { title: COPY.camera.hints[face], subtitle: COPY.stage.adjust };
  const view = result
    ? { key: `result-${result.title}`, title: result.title, subtitle: result.message }
    : sending
      ? { key: `sending-${phrase}`, title: COPY.punch.sending, subtitle: COPY.punch.phrases[phrase] }
      : { key: `face-${face}`, ...hint };

  const actions = (
    <>
      <button type="button" className={STAGE_BUTTON} onClick={retry}>{COPY.punch.again}</button>
      <button type="button" className={STAGE_BUTTON} onClick={onDone}>{COPY.punch.home}</button>
    </>
  );

  return (
    <StageShell flashlightOn={flashlightOn}>
      {failed ? (
        <StageError status={status} onRetry={() => void start()} />
      ) : (
        <>
          <StageVideo bind={camera.bindVideo} />
          <FlashlightOverlay active={flashlightOn} scale={scale} />
          <FaceGuide state={guide} scale={scale} blink={!!result && result.kind !== 'warning' && !overlay} />
          {!overlay && (
            <StageBottom contentKey={view.key} title={view.title} subtitle={view.subtitle} heading={result?.kind === 'warning'}>
              {result?.kind === 'warning' ? (
                actions
              ) : waiting ? (
                <button type="button" className={STAGE_BUTTON} disabled={status !== 'ready'} onClick={() => void capture()}>
                  <Camera size={20} aria-hidden />
                  {COPY.camera.capture}
                </button>
              ) : null}
            </StageBottom>
          )}
          <StageResultOverlay result={overlay}>
            {overlay?.kind === 'error' && <div className="flex w-full max-w-sm flex-col gap-2">{actions}</div>}
          </StageResultOverlay>
        </>
      )}
      <StageHeader
        icon={<UserFocus size={20} aria-hidden />}
        title={COPY.punch.title}
        subtitle={COPY.punch.subtitle}
        onClose={onDone}
        closeLabel={COPY.enroll.cancel}
        chip={
          failed ? undefined : (
            <div className="flex shrink-0 items-center gap-2">
              <FlashlightButton active={flashlightOn} onClick={() => setFlashlightOn((v) => !v)} />
              <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-xs tabular-nums ${flashlightOn ? 'bg-brand/10' : 'bg-white/10'}`}>
                <Timer size={13} aria-hidden />
                {countdown}s
              </span>
            </div>
          )
        }
        fraction={failed ? undefined : countdown / IDLE_TIMEOUT_S}
        flashlightOn={flashlightOn}
      />
    </StageShell>
  );
}
