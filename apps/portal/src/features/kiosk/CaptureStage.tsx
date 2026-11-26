'use client';
// Adaptado de visage/frontend/src/components/totem/CaptureStage.tsx e do laço de captura de EnrollmentWizard/CalibrationMode.
//
// Palco de captura automática do cadastro e da calibração. O quadro vira um Blob em memória entregue a quem chamou;
// nada vai para storage. Desmontar solta a câmera.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useFaceDetection } from '@/features/totems/camera/useFaceDetection';
import { meanAbsDiff, useTotemCamera } from '@/features/totems/camera/useTotemCamera';
import { framingFromFaceRatio, type Framing } from './captureGuide';
import { COPY } from './copy';
import { cameraFailed, FaceGuide, FlashlightButton, FlashlightOverlay, StageBottom, StageError, StageHeader, StageShell, StageVideo, type GuideState } from './TotemStage';

export const CAPTURE_INTERVAL_MS = 650;
/** Leituras puladas depois de cada foto (~2,3 s): tempo de ler a nova instrução. */
export const COOLDOWN_TICKS = 4;
/** Leituras boas seguidas antes da foto: evita quadro borrado. */
const STABLE_TICKS = 2;
const ACCEPTED_FLASH_MS = 900;
const MOTION_THRESHOLD = 1.0;

export function CaptureStage({ icon, title, subtitle, instruction, totalSteps, completedSteps, acceptedTick, onCapture, onClose, closeLabel, sideControls, sending = false, paused = false, anyFrame = false, requireMotion = false, maxSide = 1280, quality = 0.92 }: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  instruction: string;
  totalSteps: number;
  completedSteps: number;
  /** Cresce a cada foto aceita: dispara o flash verde da guia. */
  acceptedTick: number;
  onCapture: (image: Blob) => void;
  onClose?: () => void;
  closeLabel?: string;
  sideControls?: ReactNode;
  sending?: boolean;
  /** Há uma tela cheia por cima: a câmera não fotografa por trás dela. */
  paused?: boolean;
  /** Teste da foto na tela do celular: não exige enquadramento de rosto. */
  anyFrame?: boolean;
  /** Sem detector nativo, exige movimento entre leituras (há alguém ali). */
  requireMotion?: boolean;
  maxSide?: number;
  quality?: number;
}) {
  const camera = useTotemCamera();
  const detection = useFaceDetection();
  const { start, stop, status } = camera;
  const [framing, setFraming] = useState<Framing | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [flashlightOn, setFlashlightOn] = useState(false);
  const working = useRef(false);
  const stable = useRef(0);
  const cooldown = useRef(0);
  const lastLum = useRef<Uint8ClampedArray | null>(null);
  const blocked = useRef(false);
  blocked.current = paused || sending;

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  // Voltar de uma tela cheia começa com a pausa cheia: dá tempo de trocar de pessoa.
  const wasPaused = useRef(paused);
  useEffect(() => {
    if (wasPaused.current && !paused) {
      cooldown.current = COOLDOWN_TICKS;
      stable.current = 0;
      setFeedback(null);
      setFraming(null);
    }
    wasPaused.current = paused;
  }, [paused]);

  useEffect(() => {
    if (acceptedTick === 0) return;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), ACCEPTED_FLASH_MS);
    return () => window.clearTimeout(id);
  }, [acceptedTick]);

  const reject = (text: string | null, next: Framing | null = null) => {
    stable.current = 0;
    setFraming(next);
    setFeedback(text);
  };

  const tick = async () => {
    if (working.current || blocked.current) return;
    if (cooldown.current > 0) {
      cooldown.current -= 1;
      return;
    }
    const video = camera.videoRef.current;
    working.current = true;
    try {
      if (!anyFrame) {
        const faces = video ? await detection.detect(video) : null;
        if (faces !== null) {
          const [only] = faces;
          if (!only) return reject(COPY.camera.hints.none);
          if (faces.length > 1) return reject(COPY.camera.hints.multiple);
          const next = framingFromFaceRatio(only.width / (video?.videoWidth || 1));
          if (next !== 'good') return reject(null, next);
          setFraming(next);
        } else if (requireMotion) {
          const lum = camera.grabLuminance();
          const prev = lastLum.current;
          lastLum.current = lum;
          if (lum && prev && meanAbsDiff(lum, prev) < MOTION_THRESHOLD) return reject(COPY.camera.hints.none);
        }
      }
      setFeedback(null);
      stable.current += 1;
      if (stable.current < STABLE_TICKS) return;
      stable.current = 0;
      const blob = await camera.captureJpeg(maxSide, quality);
      if (!blob || blocked.current) return;
      cooldown.current = COOLDOWN_TICKS;
      onCapture(blob);
    } finally {
      working.current = false;
    }
  };
  // O intervalo é um só; ele chama sempre a versão mais nova da leitura.
  const tickRef = useRef(tick);
  tickRef.current = tick;

  const ready = status === 'ready';
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => void tickRef.current(), CAPTURE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [ready]);

  const guide: GuideState = flash ? 'success' : feedback ? 'error' : sending ? 'processing' : framing !== null ? 'detecting' : 'neutral';
  const scale = framing === 'far' ? 0.88 : framing === 'close' ? 1.12 : 1;
  const view = sending
    ? { key: 'sending', title: instruction, subtitle: COPY.stage.analyzing }
    : flash
      ? { key: 'accepted', title: COPY.stage.accepted, subtitle: COPY.stage.nextPose }
      : feedback
        ? { key: `feedback-${feedback}`, title: feedback, subtitle: COPY.stage.adjust }
        : framing === 'far'
          ? { key: 'far', title: COPY.camera.hints.far, subtitle: instruction }
          : framing === 'close'
            ? { key: 'close', title: COPY.camera.hints.close, subtitle: instruction }
            : { key: `guide-${instruction}`, title: instruction, subtitle: framing === 'good' ? COPY.stage.hold : COPY.stage.center };

  return (
    <StageShell flashlightOn={flashlightOn}>
      {cameraFailed(status) ? (
        <StageError status={status} onRetry={() => void start()} />
      ) : (
        <>
          <StageVideo bind={camera.bindVideo} />
          <FlashlightOverlay active={flashlightOn} scale={scale} />
          <FaceGuide state={guide} scale={scale} />
          <StageBottom contentKey={view.key} title={view.title} subtitle={view.subtitle} />
          {sideControls && <div className="absolute top-1/2 right-3 z-30 flex -translate-y-1/2 flex-col items-center gap-4 md:right-5">{sideControls}</div>}
        </>
      )}
      <StageHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        closeLabel={closeLabel}
        segments={{ total: totalSteps, completed: completedSteps }}
        chip={<FlashlightButton active={flashlightOn} onClick={() => setFlashlightOn((v) => !v)} />}
        flashlightOn={flashlightOn}
      />
    </StageShell>
  );
}
