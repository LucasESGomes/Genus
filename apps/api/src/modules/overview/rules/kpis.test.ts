import { describe, expect, it } from 'vitest';
import { datesBetween, hours, previousPeriod, toneFor, variation } from './kpis';

describe('previousPeriod', () => {
  it.each([
    ['2026-11-01', '2026-11-30', '2026-10-02', '2026-10-31'],
    ['2026-11-23', '2026-11-23', '2026-11-22', '2026-11-22'],
    ['2026-03-01', '2026-03-07', '2026-02-22', '2026-02-28'],
    ['2027-01-01', '2027-01-31', '2026-12-01', '2026-12-31'],
  ])('%s a %s → %s a %s', (from, to, pf, pt) => expect(previousPeriod(from, to)).toEqual({ from: pf, to: pt }));
});

describe('datesBetween', () => {
  it('inclui as pontas e vira o mês', () => expect(datesBetween('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']));
  it('período invertido é vazio', () => expect(datesBetween('2026-12-02', '2026-12-01')).toEqual([]));
});

describe('variation', () => {
  it.each([
    [120, 100, '+20%', 'up'],
    [80, 100, '−20%', 'down'],
    [100, 100, '+0%', 'up'],
    [90, 0, '+1,5', 'up'],
    [0, 0, '+0', 'up'],
  ] as const)('%i contra %i → %s', (cur, prev, delta, trend) => expect(variation(cur, prev, hours)).toEqual({ delta, trend }));
});

describe('toneFor', () => {
  it.each([
    ['higherIsBetter', 10, 5, 'good'],
    ['higherIsBetter', 5, 10, 'warn'],
    ['lowerIsBetter', 10, 5, 'warn'],
    ['lowerIsBetter', 5, 10, 'good'],
    ['lowerIsBetter', 5, 5, 'neutral'],
  ] as const)('%s %i/%i → %s', (k, c, p, t) => expect(toneFor(k, c, p)).toBe(t));
});

describe('hours', () => {
  it('arredonda para uma casa', () => {
    expect(hours(0)).toBe('0');
    expect(hours(90)).toBe('1,5');
    expect(hours(125)).toBe('2,1');
    expect(hours(60 * 1234)).toBe('1.234');
  });
});
