import { CLOCK_DIVERGENCE_TOLERANCE_MS } from '@genus/shared';

export interface MarkedAtResolution {
  markedAt: Date;
  isClockDivergent: boolean;
}

/**
 * Decide a hora da marcação. Se `capturedAt` está no futuro em relação ao
 * servidor, ou a mais de 30 s no passado, vale a hora do servidor e a batida é
 * sinalizada como divergente (só sinaliza; a marcação NUNCA é bloqueada).
 *
 * [A CONFIRMAR] A regra literal trata QUALQUER futuro como divergente,
 * inclusive milissegundos de defasagem de rede; confirmar se deve haver
 * tolerância também para o futuro.
 */
export function resolveMarkedAt(capturedAt: Date, serverNow: Date): MarkedAtResolution {
  const pastMs = serverNow.getTime() - capturedAt.getTime();
  const isClockDivergent = pastMs < 0 || pastMs > CLOCK_DIVERGENCE_TOLERANCE_MS;
  return {
    markedAt: isClockDivergent ? new Date(serverNow.getTime()) : capturedAt,
    isClockDivergent,
  };
}
