import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, flagIps, type IpAggregate } from './flag-ips';

const at = (iso: string) => new Date(iso);
const row = (o: Partial<IpAggregate> & { ipAddress: string }): IpAggregate => ({
  failures: 1,
  successes: 0,
  distinctAccounts: 1,
  firstSeenAt: at('2026-11-25T10:00:00Z'),
  lastSeenAt: at('2026-11-25T10:00:00Z'),
  recentFailures: 1,
  recentDistinctAccounts: 1,
  ...o,
});

describe('flagIps', () => {
  it.each([
    ['9 falhas recentes: não sinaliza', { failures: 9, recentFailures: 9 }, false, []],
    ['10 falhas recentes: muitas_falhas', { failures: 10, recentFailures: 10 }, true, ['muitas_falhas']],
    ['10 falhas, mas antigas: não sinaliza', { failures: 10, recentFailures: 0 }, false, []],
    ['2 e-mails na última hora: não sinaliza', { distinctAccounts: 2, recentDistinctAccounts: 2 }, false, []],
    ['3 e-mails na última hora: muitas_contas', { distinctAccounts: 3, recentDistinctAccounts: 3 }, true, ['muitas_contas']],
    ['3 e-mails na janela, mas fora da última hora: não sinaliza', { distinctAccounts: 3, recentDistinctAccounts: 1 }, false, []],
    ['os dois motivos', { failures: 12, recentFailures: 12, distinctAccounts: 5, recentDistinctAccounts: 4 }, true, ['muitas_falhas', 'muitas_contas']],
  ] as const)('%s', (_label, over, flagged, reasons) => {
    const [out] = flagIps([row({ ipAddress: '203.0.113.1', ...over })]);
    expect(out?.flagged).toBe(flagged);
    expect(out?.reasons).toEqual(reasons);
  });

  it('ignora IP sem falha', () => {
    expect(flagIps([row({ ipAddress: '203.0.113.2', failures: 0, successes: 4 })])).toEqual([]);
  });

  it('ordena: sinalizados, depois mais falhas, depois o mais recente', () => {
    const out = flagIps([
      row({ ipAddress: 'a', failures: 50, recentFailures: 0 }),
      row({ ipAddress: 'b', failures: 10, recentFailures: 10 }),
      row({ ipAddress: 'c', failures: 50, recentFailures: 0, lastSeenAt: at('2026-11-25T11:00:00Z') }),
      row({ ipAddress: 'd', failures: 3, recentFailures: 3, distinctAccounts: 3, recentDistinctAccounts: 3 }),
    ]);
    expect(out.map((o) => o.ipAddress)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('respeita o limite e limiares customizados', () => {
    const rows = Array.from({ length: 5 }, (_, i) => row({ ipAddress: `ip${i}`, failures: i + 1, recentFailures: i + 1 }));
    expect(flagIps(rows, DEFAULT_THRESHOLDS, 2)).toHaveLength(2);
    expect(flagIps(rows, { failures: 3, accounts: 99 }).filter((o) => o.flagged).map((o) => o.ipAddress)).toEqual(['ip4', 'ip3', 'ip2']);
  });
});
