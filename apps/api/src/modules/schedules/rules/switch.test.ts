import { describe, expect, it } from 'vitest';
import { planSwitch, type AssignmentRange } from './switch';

const a = (id: number, validFrom: string, validTo: string | null, scheduleId = 1): AssignmentRange => ({ id, scheduleId, validFrom, validTo });

describe('planSwitch (troca de escala a partir de uma data)', () => {
  it.each([
    {
      caso: 'sem vínculo: abre o novo em aberto',
      rows: [],
      from: '2026-12-01',
      want: { kind: 'insert', close: null, newValidTo: null },
    },
    {
      caso: 'vínculo em aberto: encerra no dia anterior e o novo fica em aberto',
      rows: [a(1, '2026-01-01', null)],
      from: '2026-12-01',
      want: { kind: 'insert', close: { id: 1, validTo: '2026-11-30', previousValidTo: null }, newValidTo: null },
    },
    {
      caso: 'virada de ano: encerra em 31/12',
      rows: [a(1, '2026-01-01', null)],
      from: '2027-01-01',
      want: { kind: 'insert', close: { id: 1, validTo: '2026-12-31', previousValidTo: null }, newValidTo: null },
    },
    {
      caso: 'vínculo com fim: o novo herda o fim',
      rows: [a(1, '2026-01-01', '2026-12-31')],
      from: '2026-12-16',
      want: { kind: 'insert', close: { id: 1, validTo: '2026-12-15', previousValidTo: '2026-12-31' }, newValidTo: '2026-12-31' },
    },
    {
      caso: 'há vínculo futuro: o novo termina antes dele',
      rows: [a(1, '2026-01-01', '2026-11-30'), a(2, '2027-02-01', null)],
      from: '2026-12-10',
      want: { kind: 'insert', close: null, newValidTo: '2027-01-31' },
    },
  ])('$caso', ({ rows, from, want }) => {
    expect(planSwitch(rows, from)).toEqual(want);
  });

  it('vínculo que começa no mesmo dia: troca só a escala dele', () => {
    const current = a(7, '2026-12-01', null, 3);
    expect(planSwitch([current], '2026-12-01')).toEqual({ kind: 'replace', current });
  });
});
