/**
 * Formatação de tela. NÃO calcula regra trabalhista: só apresenta o que a api entregou.
 * Datas civis (`AAAA-MM-DD`) não têm fuso e não passam por conversão; instantes (ISO 8601)
 * são mostrados no fuso do estabelecimento.
 */
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';
import type { Clock } from '../clock';

/** Fuso padrão enquanto o back não manda o fuso do estabelecimento (pendência: GET /portal/establishments). */
export const DEFAULT_TZ = 'America/Sao_Paulo';

const pad = (n: number) => String(n).padStart(2, '0');

/** 545 → "09:05"; -150 → "-02:30"; com `signed`, 30 → "+00:30". Minutos inteiros vindos da api. */
export function formatMinutes(minutes: number, opts: { signed?: boolean } = {}): string {
  const sign = minutes < 0 ? '-' : opts.signed && minutes > 0 ? '+' : '';
  const abs = Math.abs(Math.trunc(minutes));
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Texto para leitor de tela: 545 → "9 horas e 5 minutos". */
export function describeMinutes(minutes: number): string {
  const abs = Math.abs(Math.trunc(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const parts = [h ? `${h} ${h === 1 ? 'hora' : 'horas'}` : '', m || !h ? `${m} ${m === 1 ? 'minuto' : 'minutos'}` : ''].filter(Boolean);
  return `${minutes < 0 ? 'menos ' : ''}${parts.join(' e ')}`;
}

function civilParts(civil: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!m) throw new RangeError(`data civil inválida: ${civil}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Data civil como Date local ao meio-dia (evita virar o dia em qualquer fuso). Uso interno de formatação. */
function civilToDate(civil: string): Date {
  const [y, mo, d] = civilParts(civil);
  return new Date(y, mo - 1, d, 12);
}

const toCivil = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type CivilStyle = 'short' | 'medium' | 'long' | 'weekday' | 'dayMonth';
const CIVIL_PATTERN: Record<CivilStyle, string> = {
  short: 'dd/MM/yyyy', // 21/11/2026
  medium: "d 'de' MMM 'de' yyyy", // 21 de nov. de 2026
  long: "d 'de' MMMM 'de' yyyy", // 21 de novembro de 2026
  weekday: "EEE, dd/MM", // sáb., 21/11
  dayMonth: 'dd/MM', // 21/11
};

export function formatDate(civil: string, style: CivilStyle = 'short'): string {
  return format(civilToDate(civil), CIVIL_PATTERN[style], { locale: ptBR });
}

/** Dia da semana curto, ex.: "Sáb". */
export function weekdayShort(civil: string): string {
  const s = format(civilToDate(civil), 'EEEE', { locale: ptBR }).slice(0, 3);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Instante ISO no fuso do estabelecimento. Padrões: 'HH:mm', "dd/MM/yyyy 'às' HH:mm"… */
export function formatInstant(iso: string, tz: string = DEFAULT_TZ, pattern = "dd/MM/yyyy 'às' HH:mm"): string {
  return formatInTimeZone(iso, tz, pattern, { locale: ptBR });
}

export const formatTime = (iso: string, tz: string = DEFAULT_TZ) => formatInstant(iso, tz, 'HH:mm');

/** Data civil de um instante no fuso dado. */
export const civilDateOf = (iso: string | Date, tz: string = DEFAULT_TZ) => formatInTimeZone(iso, tz, 'yyyy-MM-dd');

/** "Hoje" no fuso do estabelecimento, pelo relógio injetado. */
export const todayCivil = (clock: Clock, tz: string = DEFAULT_TZ) => civilDateOf(clock.now(), tz);

/** Desloca uma data civil em dias de calendário (navegação de tela, não regra trabalhista). */
export function addCivilDays(civil: string, days: number): string {
  const d = civilToDate(civil);
  d.setDate(d.getDate() + days);
  return toCivil(d);
}

/** "2026-11-21" → "2026-11". */
export const monthOf = (civil: string) => civil.slice(0, 7);

/** "2026-11" → { from: "2026-11-01", to: "2026-11-30" }. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, mo] = civilParts(`${month}-01`);
  const last = new Date(y, mo, 0, 12).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

export function addMonths(month: string, n: number): string {
  const [y, mo] = civilParts(`${month}-01`);
  const d = new Date(y, mo - 1 + n, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "2026-11" → "novembro de 2026". */
export const formatMonth = (month: string) => format(civilToDate(`${month}-01`), "MMMM 'de' yyyy", { locale: ptBR });

/** "1 a 21 de novembro de 2026" (mesmo mês) ou "28/10/2026 a 03/11/2026". */
export function formatPeriod(from: string, to: string): string {
  if (from.slice(0, 7) === to.slice(0, 7)) return `${civilParts(from)[2]} a ${formatDate(to, 'long')}`;
  return `${formatDate(from)} a ${formatDate(to)}`;
}

/**
 * CPF para exibição. 11 dígitos → 000.000.000-00. Já mascarado pela api (***.***.***-NN) → como veio.
 * O front nunca guarda nem loga CPF; a api decide quem recebe o completo.
 */
export function formatCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  if (d.length === 11 && !cpf.includes('*')) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return cpf;
}

export const formatNumber = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

export const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

/** Iniciais para avatar: "Lúcia Martins" → "LM". */
export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p[p.length - 1]?.[0] ?? '') : '')).toUpperCase();
}
