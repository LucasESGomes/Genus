// Adaptado de visage/frontend/src/components/totem/captureGuide.ts (fonte somente leitura)
//
// Regras puras da captura guiada: enquadramento pela largura do rosto e "rosto parado" para a foto automática.

export type Framing = 'far' | 'close' | 'good';

/** Rosto pequeno ou grande demais para a engine (detector perde confiança acima de ~40% da largura). */
export function framingFromFaceRatio(ratio: number): Framing {
  if (ratio < 0.18) return 'far';
  if (ratio > 0.4) return 'close';
  return 'good';
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Quantas leituras seguidas "bom e parado" disparam a foto automática (~1,2 s a 400 ms por leitura). */
export const STILL_TICKS_TO_CAPTURE = 3;
/** Deslocamento do centro do rosto entre leituras (fração da largura do vídeo) abaixo do qual está parado. */
export const STILL_MAX_SHIFT = 0.04;

/** Rosto parado = o centro quase não andou desde a leitura anterior. */
export function isStill(prev: FaceBox | null, next: FaceBox, videoWidth: number): boolean {
  if (!prev || videoWidth <= 0) return false;
  const dx = Math.abs(prev.x + prev.width / 2 - (next.x + next.width / 2));
  const dy = Math.abs(prev.y + prev.height / 2 - (next.y + next.height / 2));
  return Math.hypot(dx, dy) / videoWidth <= STILL_MAX_SHIFT;
}

/** Conta leituras seguidas "boas e paradas"; qualquer falha zera. */
export function nextStillCount(count: number, good: boolean, still: boolean): number {
  return good && still ? count + 1 : 0;
}
