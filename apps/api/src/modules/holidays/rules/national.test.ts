import { describe, expect, it } from 'vitest';
import { easterSunday, nationalHolidays } from './national';

describe('easterSunday (Meeus)', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
  ])('%i → %s', (year, date) => expect(easterSunday(year)).toBe(date));
});

describe('nationalHolidays', () => {
  it('2026: 9 fixos e 4 facultativos, em ordem de data', () => {
    const list = nationalHolidays(2026);
    expect(list).toHaveLength(13);
    expect(list.filter((h) => !h.isOptional).map((h) => h.date)).toEqual([
      '2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25',
    ]);
    expect(list.filter((h) => h.isOptional).map((h) => [h.date, h.name])).toEqual([
      ['2026-02-16', 'Carnaval (segunda-feira)'],
      ['2026-02-17', 'Carnaval (terça-feira)'],
      ['2026-04-03', 'Sexta-feira Santa'],
      ['2026-06-04', 'Corpus Christi'],
    ]);
  });

  it('ano bissexto: Carnaval de 2028 cai em 28 e 29/02', () => {
    expect(nationalHolidays(2028).filter((h) => h.name.startsWith('Carnaval')).map((h) => h.date)).toEqual(['2028-02-28', '2028-02-29']);
  });
});
