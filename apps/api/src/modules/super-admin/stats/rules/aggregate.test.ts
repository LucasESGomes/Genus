import { describe, expect, it } from 'vitest';
import { buildGrowth, fillDays, growthStart, lastMonths, processedRate, topByPunches, totalizePunches, windowRange } from './aggregate';

describe('windowRange', () => {
  it.each([
    ['24h', '2026-11-24T12:00:00.000Z'],
    ['7d', '2026-11-18T12:00:00.000Z'],
    ['30d', '2026-10-26T12:00:00.000Z'],
  ] as const)('%s', (w, from) => {
    const now = new Date('2026-11-25T12:00:00Z');
    expect(windowRange(w, now)).toEqual({ from: new Date(from), to: now });
  });
});

describe('processedRate', () => {
  it.each([
    [0, 0, null],
    [0, 4, 0],
    [3, 4, 0.75],
    [1, 3, 0.3333],
    [4, 4, 1],
  ])('%d de %d -> %s', (p, t, expected) => expect(processedRate(p, t)).toBe(expected));
});

describe('fillDays', () => {
  it('preenche dias sem batida com 0 e soma linhas do mesmo dia', () => {
    const out = fillDays(new Date('2026-11-22T12:00:00Z'), new Date('2026-11-25T12:00:00Z'), [
      { day: '2026-11-23', punches: 2 },
      { day: '2026-11-23', punches: 3 },
      { day: '2026-11-25', punches: 1 },
    ]);
    expect(out).toEqual([
      { day: '2026-11-22', punches: 0 },
      { day: '2026-11-23', punches: 5 },
      { day: '2026-11-24', punches: 0 },
      { day: '2026-11-25', punches: 1 },
    ]);
  });
  it('janela de 24h que cruza a meia-noite cobre 2 dias', () => {
    expect(fillDays(new Date('2026-11-24T12:00:00Z'), new Date('2026-11-25T12:00:00Z'), []).map((d) => d.day)).toEqual(['2026-11-24', '2026-11-25']);
  });
  it('`to` exatamente à meia-noite não inclui o dia seguinte (intervalo aberto)', () => {
    expect(fillDays(new Date('2026-11-24T00:00:00Z'), new Date('2026-11-25T00:00:00Z'), []).map((d) => d.day)).toEqual(['2026-11-24']);
  });
});

describe('totalizePunches e topByPunches', () => {
  const rows = [
    { day: '2026-11-24', tenantId: 2, punches: 10, processed: 9 },
    { day: '2026-11-25', tenantId: 2, punches: 5, processed: 5 },
    { day: '2026-11-25', tenantId: 1, punches: 15, processed: 0 },
    { day: '2026-11-25', tenantId: 3, punches: 1, processed: 1 },
  ];
  const t = totalizePunches(rows, new Date('2026-11-24T10:00:00Z'), new Date('2026-11-25T10:00:00Z'));
  it('totais', () => {
    expect(t.punches).toBe(31);
    expect(t.processed).toBe(15);
    expect(t.perDay).toEqual([
      { day: '2026-11-24', punches: 10 },
      { day: '2026-11-25', punches: 21 },
    ]);
  });
  it('top: desempata pelo menor id e respeita o limite', () => {
    expect(topByPunches(t.perTenant, 2)).toEqual([
      { tenantId: 1, punches: 15 },
      { tenantId: 2, punches: 15 },
    ]);
  });
});

describe('meses', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  it('lastMonths cruza o ano', () => expect(lastMonths(3, new Date('2026-01-15T00:00:00Z'))).toEqual(['2025-11', '2025-12', '2026-01']));
  it('um mês só', () => expect(lastMonths(1, now)).toEqual(['2026-11']));
  it('growthStart', () => expect(growthStart(12, now).toISOString()).toBe('2025-12-01T00:00:00.000Z'));

  it('buildGrowth acumula e preenche meses vazios', () => {
    const out = buildGrowth(
      ['2026-09', '2026-10', '2026-11'],
      { before: 2, byMonth: [{ month: '2026-09', count: 1 }, { month: '2026-11', count: 2 }] },
      { before: 10, byMonth: [{ month: '2026-10', count: 5 }] },
    );
    expect(out).toEqual([
      { month: '2026-09', newTenants: 1, totalTenants: 3, newEmployees: 0, totalEmployees: 10 },
      { month: '2026-10', newTenants: 0, totalTenants: 3, newEmployees: 5, totalEmployees: 15 },
      { month: '2026-11', newTenants: 2, totalTenants: 5, newEmployees: 0, totalEmployees: 15 },
    ]);
  });
});
