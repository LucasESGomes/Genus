/**
 * Datas e horas civis em inteiros, sem fuso e sem relógio do sistema.
 *
 * Quem chama converte o instante (timestamptz do arp) para a hora local do
 * estabelecimento (RNF07) antes de entrar nas regras. Aqui só há aritmética:
 * dia civil = número de dias desde 1970-01-01; instante local = minutos desde
 * 1970-01-01 00:00 local. Resolução de minuto, como no AFD.
 */
import { RhDomainError } from './errors';

/** `YYYY-MM-DD`. */
export type CivilDate = string;
/** `YYYY-MM-DDTHH:mm`, já na hora local do estabelecimento. */
export type LocalDateTime = string;
/** `HH:mm`. */
export type TimeOfDay = string;

export const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function invalid(kind: string, value: string): never {
  throw new RhDomainError('DATA_INVALIDA', `${kind} inválida: ${value}`, { value });
}

/** Dia civil como inteiro (dias desde 1970-01-01). */
export function dayNumber(date: CivilDate): number {
  const m = DATE_RE.exec(date);
  if (!m) invalid('Data', date);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Date.UTC aceita 2026-02-31 e rola para março; a volta confere.
  if (fromDayNumber(ms / MS_PER_DAY) !== date) invalid('Data', date);
  return ms / MS_PER_DAY;
}

export function fromDayNumber(n: number): CivilDate {
  const d = new Date(n * MS_PER_DAY);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** `b - a` em dias. */
export function diffDays(a: CivilDate, b: CivilDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** Soma meses; se o dia não existe no mês de destino, usa o último dia do mês. */
export function addMonths(date: CivilDate, months: number): CivilDate {
  const m = DATE_RE.exec(date);
  if (!m) invalid('Data', date);
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months;
  const y = Math.floor(total / 12);
  const mo = total - y * 12;
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(Number(m[3]), lastDay);
  return fromDayNumber(Date.UTC(y, mo, d) / MS_PER_DAY);
}

/** Dia da semana ISO: 1 = segunda ... 7 = domingo. */
export function isoWeekday(date: CivilDate): number {
  // 1970-01-01 foi quinta-feira (ISO 4).
  return ((((dayNumber(date) + 3) % 7) + 7) % 7) + 1;
}

export function timeOfDayMinutes(time: TimeOfDay): number {
  const m = TIME_RE.exec(time);
  if (!m) invalid('Hora', time);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) invalid('Hora', time);
  return h * 60 + mi;
}

/** Instante local em minutos desde 1970-01-01 00:00 (hora local). */
export function localMinutes(value: LocalDateTime): number {
  const m = DATETIME_RE.exec(value);
  if (!m) invalid('Data e hora', value);
  return dayNumber(m[1] as string) * MINUTES_PER_DAY + timeOfDayMinutes(`${m[2]}:${m[3]}`);
}

export function isWithin(date: CivilDate, from: CivilDate, to: CivilDate | null): boolean {
  return from <= date && (to === null || date <= to);
}

/** Interseção, em dias, de dois intervalos fechados `[a1, a2]` e `[b1, b2]`. */
export function rangesOverlap(a1: CivilDate, a2: CivilDate, b1: CivilDate, b2: CivilDate): boolean {
  return a1 <= b2 && b1 <= a2;
}

/** Divisão inteira com arredondamento meio para cima, para não usar float. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}
