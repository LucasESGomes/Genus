/**
 * Regras puras da visão geral (G11): período anterior de mesmo tamanho, variação
 * e texto dos KPIs. A api entrega os textos prontos; o front só exibe.
 */
import { addDays, diffDays, type CivilDate } from '../../rules-common/rules/civil-time';

export type Trend = 'up' | 'down';
export type Tone = 'good' | 'warn' | 'neutral';

/** Período imediatamente anterior, com o mesmo número de dias. */
export function previousPeriod(from: CivilDate, to: CivilDate): { from: CivilDate; to: CivilDate } {
  const days = diffDays(from, to) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

/** Todas as datas de `from` a `to`, inclusive. */
export function datesBetween(from: CivilDate, to: CivilDate): CivilDate[] {
  const n = diffDays(from, to) + 1;
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(from, i));
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Minutos em horas, com uma casa (pt-BR): 90 → "1,5". */
export const hours = (minutes: number) => decimal.format(Math.round((minutes / 60) * 10) / 10);
export const count = (n: number) => integer.format(n);

/**
 * Variação contra o período anterior. Com anterior zero não há porcentagem: mostra a
 * diferença absoluta (no formato do valor).
 */
export function variation(current: number, previous: number, format: (n: number) => string): { delta: string; trend: Trend } {
  const trend: Trend = current >= previous ? 'up' : 'down';
  if (previous === 0) {
    const diff = current - previous;
    return { delta: `${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))}`, trend };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  return { delta: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`, trend };
}

/**
 * Tom da variação: subir é bom para horas trabalhadas e ruim para extra e falta.
 * Sem variação, neutro.
 */
export function toneFor(kind: 'higherIsBetter' | 'lowerIsBetter', current: number, previous: number): Tone {
  if (current === previous) return 'neutral';
  const better = kind === 'higherIsBetter' ? current > previous : current < previous;
  return better ? 'good' : 'warn';
}
