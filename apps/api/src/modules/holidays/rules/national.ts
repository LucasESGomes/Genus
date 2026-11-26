/**
 * Feriados nacionais (G3, RF14). Regra pura: a migration 0021 carrega o resultado
 * de 2026 a 2030 em `rh.feriados` (conta_id NULL), e o teste confere os dois.
 *
 * Fixos: Lei 662/1949 (com a redação da Lei 10.607/2002), Lei 6.802/1980
 * (12/10) e Lei 14.759/2023 (20/11, Dia Nacional de Zumbi e da Consciência Negra).
 * Móveis (Carnaval, Sexta-feira Santa e Corpus Christi) entram como FACULTATIVOS
 * [A CONFIRMAR]: não são feriado nacional por lei federal (Sexta-feira Santa é
 * feriado religioso que o município declara, Lei 9.093/1995). O RH decide por
 * estabelecimento, cadastrando o feriado da conta na mesma data.
 */
import { addDays, type CivilDate } from '../../rules-common/rules/civil-time';

export interface NationalHoliday {
  date: CivilDate;
  name: string;
  isOptional: boolean;
}

const FIXED: readonly [string, string][] = [
  ['01-01', 'Confraternização Universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['12-25', 'Natal'],
];

const pad = (n: number) => String(n).padStart(2, '0');

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function easterSunday(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function nationalHolidays(year: number): NationalHoliday[] {
  const easter = easterSunday(year);
  const movable: NationalHoliday[] = [
    { date: addDays(easter, -48), name: 'Carnaval (segunda-feira)', isOptional: true },
    { date: addDays(easter, -47), name: 'Carnaval (terça-feira)', isOptional: true },
    { date: addDays(easter, -2), name: 'Sexta-feira Santa', isOptional: true },
    { date: addDays(easter, 60), name: 'Corpus Christi', isOptional: true },
  ];
  const fixed = FIXED.map(([md, name]) => ({ date: `${year}-${md}`, name, isOptional: false }));
  return [...fixed, ...movable].sort((x, y) => x.date.localeCompare(y.date));
}
