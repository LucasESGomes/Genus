/**
 * Trabalho noturno (RN07).
 * - Urbano: CLT art. 73; janela e hora reduzida (52 min 30 s, §1º) vêm do parâmetro.
 * - Rural: Lei 5.889/1973 art. 7º; janela diferente para lavoura e pecuária, sem
 *   hora reduzida. O tipo de atividade é entrada; janela e hora também vêm do parâmetro.
 *
 * Prorrogação da jornada noturna depois do fim da janela (Súmula 60, II, TST) não
 * está na especificação: não é aplicada (teste pendente).
 */
import { divRoundHalfUp, MINUTES_PER_DAY } from '../../rules-common/rules/civil-time';

export type NightWorkType = 'urbano' | 'rural_lavoura' | 'rural_pecuaria';

export interface NightWindow {
  /** Início da janela, minutos desde 00:00 (ex.: 22:00 = 1320). */
  startMinute: number;
  /** Fim da janela, minutos desde 00:00. Menor que o início = cruza a meia-noite. */
  endMinute: number;
  /** Duração legal da hora noturna em segundos: 3150 reduzida, 3600 sem redução. */
  hourSeconds: number;
}

/** Segmento de trabalho em minutos locais absolutos, `[start, end)`. */
export interface Segment {
  start: number;
  end: number;
}

function overlap(a: Segment, b: Segment): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Minutos de relógio do segmento dentro da janela noturna, inclusive quando cruza a meia-noite. */
export function nightClockMinutes(segment: Segment, window: NightWindow): number {
  if (segment.end <= segment.start) return 0;
  const firstDay = Math.floor(segment.start / MINUTES_PER_DAY) - 1;
  const lastDay = Math.floor(segment.end / MINUTES_PER_DAY);
  const crosses = window.endMinute <= window.startMinute;
  let total = 0;
  for (let day = firstDay; day <= lastDay; day++) {
    const base = day * MINUTES_PER_DAY;
    const nightWindow: Segment = {
      start: base + window.startMinute,
      end: base + window.endMinute + (crosses ? MINUTES_PER_DAY : 0),
    };
    total += overlap(segment, nightWindow);
  }
  return total;
}

/**
 * Minutos de relógio convertidos em minutos "de hora noturna" (60 × relógio ×
 * 60 / segundos da hora). Arredonda meio para cima no total do dia [A CONFIRMAR].
 */
export function nightEquivalentMinutes(clockMinutes: number, window: NightWindow): number {
  return divRoundHalfUp(clockMinutes * 3600, window.hourSeconds);
}
