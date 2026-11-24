/**
 * Instante (UTC) ↔ hora civil local do estabelecimento. As regras de apuração
 * trabalham em hora local (`LocalDateTime`); o arp grava instantes (`timestamptz`).
 *
 * O schema não tem o fuso do estabelecimento: ele sai da UF, pelo fuso que
 * cobre a capital [A CONFIRMAR: estados com mais de um fuso, como AM e PA,
 * precisam de uma coluna própria]. Determinístico: depende só da base de fusos do Node.
 */
import type { CivilDate, LocalDateTime } from './civil-time';
import { RhDomainError } from './errors';

const UF_TIMEZONE: Readonly<Record<string, string>> = {
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  RR: 'America/Boa_Vista',
  RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  PA: 'America/Belem',
  AP: 'America/Belem',
  TO: 'America/Araguaina',
  MA: 'America/Fortaleza',
  PI: 'America/Fortaleza',
  CE: 'America/Fortaleza',
  RN: 'America/Fortaleza',
  PB: 'America/Fortaleza',
  PE: 'America/Recife',
  AL: 'America/Maceio',
  SE: 'America/Maceio',
  BA: 'America/Bahia',
  MG: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  RJ: 'America/Sao_Paulo',
  SP: 'America/Sao_Paulo',
  PR: 'America/Sao_Paulo',
  SC: 'America/Sao_Paulo',
  RS: 'America/Sao_Paulo',
  GO: 'America/Sao_Paulo',
  DF: 'America/Sao_Paulo',
};

export function timezoneForUf(uf: string): string {
  const tz = UF_TIMEZONE[uf];
  if (!tz) throw new RhDomainError('DATA_INVALIDA', 'UF sem fuso conhecido', { uf });
  return tz;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

function parts(instant: Date, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(instant)) out[p.type] = p.value;
  return out;
}

/** Instante → `YYYY-MM-DDTHH:mm` no fuso. Os segundos são descartados (a apuração é em minutos). */
export function toLocalDateTime(instant: Date, tz: string): LocalDateTime {
  const p = parts(instant, tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function toCivilDate(instant: Date, tz: string): CivilDate {
  return toLocalDateTime(instant, tz).slice(0, 10);
}

/** Diferença (ms) entre a hora local do fuso e o UTC no instante dado. */
function offsetMs(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** `YYYY-MM-DDTHH:mm` local → instante. Usado para montar a janela do dia em UTC. */
export function localToInstant(local: LocalDateTime, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new RhDomainError('DATA_INVALIDA', 'Hora local inválida', { local });
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const first = guess - offsetMs(new Date(guess), tz);
  // segunda passada: acerta a virada de horário de verão, se houver
  return new Date(guess - offsetMs(new Date(first), tz));
}
