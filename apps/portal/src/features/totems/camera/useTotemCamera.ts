'use client';
// Adaptado de visage/frontend/src/components/totem/useTotemCamera.ts (fonte somente leitura)
//
// Diferenças em relação à Visage:
// - Só abre a câmera em contexto seguro (HTTPS ou localhost). Fora dele, `status = 'insecure'` e getUserMedia NUNCA é chamado.
// - Os frames ficam só em memória. `captureJpeg` (usado só pelo totem web /totem) devolve um Blob que quem chama envia e descarta;
//   o teste de câmera do painel nunca chama. Nada é gravado em storage.
// - `stop` e o desmonte soltam o MediaStream (todas as trilhas). Se a câmera abrir depois de um Parar/desmonte, é solta na hora.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'error' | 'insecure' | 'unsupported';

/** Ciclo de vida da câmera frontal + leitura de luminância para a detecção de presença por movimento. */
export function useTotemCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const probeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Cada Iniciar/Parar/desmonte muda a geração: uma abertura que termina tarde descobre que foi cancelada. */
  const generationRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>('idle');

  const release = useCallback(() => {
    generationRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stop = useCallback(() => {
    release();
    setStatus('idle');
  }, [release]);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (typeof window === 'undefined' || !window.isSecureContext) {
      setStatus('insecure');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    const generation = ++generationRef.current;
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (generation !== generationRef.current) {
        // Parou (ou desmontou) enquanto a câmera abria: solta agora.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus('ready');
    } catch {
      if (generation === generationRef.current) setStatus('error');
    }
  }, []);

  // O <video> costuma montar só DEPOIS de status = 'ready': anexa o stream assim que ele existir.
  useEffect(() => {
    if (status !== 'ready') return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play?.()?.catch(() => undefined);
    }
  }, [status]);

  /** Ref de callback do <video>: reanexa o stream se o elemento remontar. */
  const bindVideo = useCallback((el: HTMLVideoElement | null) => {
    (videoRef as MutableRefObject<HTMLVideoElement | null>).current = el;
    const stream = streamRef.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      void el.play?.()?.catch(() => undefined);
    }
  }, []);

  // Contexto inseguro: avisa desde o início (o botão Iniciar fica desabilitado) e nunca chama getUserMedia.
  useEffect(() => {
    if (!window.isSecureContext) setStatus('insecure');
    else if (!navigator.mediaDevices?.getUserMedia) setStatus('unsupported');
  }, []);

  // Desmontar solta a câmera, sempre.
  useEffect(() => release, [release]);

  /** Luminância 64×64 do recorte central: detecção de presença por movimento. */
  const grabLuminance = useCallback((): Uint8ClampedArray | null => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    if (!probeCanvasRef.current) probeCanvasRef.current = document.createElement('canvas');
    const size = 64;
    const canvas = probeCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    canvas.width = size;
    canvas.height = size;
    const crop = Math.min(video.videoWidth, video.videoHeight) * 0.6;
    ctx.drawImage(video, (video.videoWidth - crop) / 2, (video.videoHeight - crop) / 2, crop, crop, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    const lum = new Uint8ClampedArray(size * size);
    for (let i = 0; i < lum.length; i++) {
      const o = i * 4;
      lum[i] = 0.299 * (data[o] ?? 0) + 0.587 * (data[o + 1] ?? 0) + 0.114 * (data[o + 2] ?? 0);
    }
    return lum;
  }, []);

  /** Quadro atual como JPEG (lado maior limitado a `maxSide`). Sem espelhar: a prévia espelhada é só visual. */
  const captureJpeg = useCallback(async (maxSide = 1280, quality = 0.9): Promise<Blob | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    canvas.width = 0;
    canvas.height = 0;
    return blob;
  }, []);

  return { videoRef, bindVideo, status, start, stop, grabLuminance, captureJpeg };
}

export type TotemCameraHandle = ReturnType<typeof useTotemCamera>;

export function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / a.length;
}
