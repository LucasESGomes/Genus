'use client';
// Adaptado de visage/frontend/src/components/totem/CaptureStage.tsx e TotemCamera.tsx (fonte somente leitura)
//
// Câmera frontal com guia oval. Só abre em contexto seguro; solta todas as trilhas ao desmontar; o quadro vira um
// Blob em memória que o pai envia e descarta (nada vai para storage). Foto automática (opcional) quando um rosto
// bem enquadrado fica parado; sempre existe o botão "Tirar foto" como alternativa.
import { CameraSlash, Lock, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { useFaceDetection } from '@/features/totems/camera/useFaceDetection';
import { useTotemCamera } from '@/features/totems/camera/useTotemCamera';
import { cn } from '@/lib/utils';
import { framingFromFaceRatio, isStill, nextStillCount, STILL_TICKS_TO_CAPTURE, type FaceBox } from './captureGuide';
import { COPY } from './copy';
import { BIG_BUTTON } from './KioskFrame';

const DETECT_INTERVAL_MS = 400;

type Hint = keyof typeof COPY.camera.hints;

export function CaptureCamera({ onCapture, auto = false, busy = false, captureLabel = COPY.camera.capture }: {
  onCapture: (image: Blob) => void;
  /** Dispara a foto sozinho quando o rosto está bem enquadrado e parado (só com detector nativo). */
  auto?: boolean;
  /** Enquanto ocupado (enviando), não captura. */
  busy?: boolean;
  captureLabel?: string;
}) {
  const { status, bindVideo, videoRef, start, stop, captureJpeg } = useTotemCamera();
  const detection = useFaceDetection();
  const [hint, setHint] = useState<Hint>('manual');
  const [good, setGood] = useState(false);
  const stillRef = useRef(0);
  const prevBox = useRef<FaceBox | null>(null);
  const busyRef = useRef(busy);
  const capturingRef = useRef(false);
  const ready = status === 'ready';
  const native = detection.supported === true;

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  // Abre ao montar; o desmonte solta a câmera (o hook cuida disso).
  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  const capture = useCallback(async () => {
    if (capturingRef.current || busyRef.current) return;
    capturingRef.current = true;
    try {
      const blob = await captureJpeg();
      if (blob) onCapture(blob);
    } finally {
      capturingRef.current = false;
    }
  }, [captureJpeg, onCapture]);

  const tick = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || busyRef.current || capturingRef.current) return;
    const faces = await detection.detect(video);
    if (faces === null) return;
    if (faces.length === 0) {
      prevBox.current = null;
      stillRef.current = 0;
      setGood(false);
      return setHint('none');
    }
    const [only] = faces;
    if (faces.length > 1 || !only) {
      prevBox.current = null;
      stillRef.current = 0;
      setGood(false);
      return setHint('multiple');
    }
    const framing = framingFromFaceRatio(only.width / video.videoWidth);
    setHint(framing);
    setGood(framing === 'good');
    stillRef.current = nextStillCount(stillRef.current, framing === 'good', isStill(prevBox.current, only, video.videoWidth));
    prevBox.current = only;
    if (auto && stillRef.current >= STILL_TICKS_TO_CAPTURE) {
      stillRef.current = 0;
      void capture();
    }
  }, [auto, capture, detection, videoRef]);

  useEffect(() => {
    if (!ready || !native) return;
    const id = window.setInterval(() => void tick(), DETECT_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [ready, native, tick]);

  const hintText = native ? COPY.camera.hints[hint] : COPY.camera.hints.manual;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[3/4] max-h-[58dvh] w-full overflow-hidden rounded-card border border-line bg-brand">
        {ready ? (
          <>
            {/* Espelhado como um espelho. Nenhum quadro é guardado: só viram Blob na hora da foto. */}
            <video ref={bindVideo} autoPlay playsInline muted aria-label="Imagem da câmera" className="absolute inset-0 h-full w-full -scale-x-100 object-cover" />
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className={cn('aspect-[3/4] h-[78%] rounded-[50%] border-solid border-white shadow-[0_0_0_9999px_color-mix(in_srgb,var(--color-brand)_45%,transparent)]', good ? 'border-4' : 'border-2')} />
            </div>
          </>
        ) : (
          <Unavailable status={status} onRetry={() => void start()} />
        )}
      </div>
      <p role="status" aria-live="polite" className="m-0 min-h-7 text-center text-lg font-semibold">{ready ? hintText : ''}</p>
      <Button variant="primary" className={BIG_BUTTON} disabled={!ready || busy} onClick={() => void capture()}>{captureLabel}</Button>
    </div>
  );
}

function Unavailable({ status, onRetry }: { status: ReturnType<typeof useTotemCamera>['status']; onRetry: () => void }) {
  const map: Record<string, { icon: ReactNode; text: string }> = {
    insecure: { icon: <Lock size={32} aria-hidden />, text: COPY.camera.insecure },
    unsupported: { icon: <CameraSlash size={32} aria-hidden />, text: COPY.camera.unsupported },
    error: { icon: <WarningCircle size={32} aria-hidden />, text: COPY.camera.error },
  };
  const info = map[status];
  return (
    <div role={info ? 'alert' : 'status'} className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
      {info?.icon}
      <p className="m-0 text-base font-semibold">{info ? info.text : COPY.camera.opening}</p>
      {(status === 'error' || status === 'idle') && (
        <Button variant="secondary" className="h-12" onClick={onRetry}>{COPY.camera.retry}</Button>
      )}
    </div>
  );
}
