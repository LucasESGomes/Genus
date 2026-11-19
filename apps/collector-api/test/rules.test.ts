import { describe, expect, it } from 'vitest';
import { resolveMarkedAt } from '../src/modules/punches/rules/clock-divergence';
import { detectImageType } from '../src/modules/punches/rules/image-signature';
import { formatServerTiming } from '../src/modules/punches/routes';
import { isValidServiceKey } from '../src/plugins/service-key-auth';
import { createHash } from 'node:crypto';

const SERVER = new Date('2026-11-18T12:00:00.000Z');
const at = (offsetMs: number) => new Date(SERVER.getTime() + offsetMs);

describe('resolveMarkedAt', () => {
  it.each([
    ['agora', 0, false],
    ['10 s no passado', -10_000, false],
    ['exatamente 30 s no passado', -30_000, false],
    ['30,001 s no passado', -30_001, true],
    ['2 min no passado', -120_000, true],
    ['1 ms no futuro (regra literal; [A CONFIRMAR])', 1, true],
    ['1 min no futuro', 60_000, true],
  ])('%s', (_name, offset, divergent) => {
    const captured = at(offset);
    const r = resolveMarkedAt(captured, SERVER);
    expect(r.isClockDivergent).toBe(divergent);
    expect(r.markedAt.getTime()).toBe(divergent ? SERVER.getTime() : captured.getTime());
  });

  it('não devolve a mesma instância do relógio do servidor', () => {
    const r = resolveMarkedAt(at(60_000), SERVER);
    expect(r.markedAt).not.toBe(SERVER);
  });
});

describe('detectImageType', () => {
  it.each([
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0, 0x00], 'image/jpeg'],
    ['JPEG mínimo', [0xff, 0xd8, 0xff], 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00], 'image/png'],
    ['PNG truncado', [0x89, 0x50, 0x4e, 0x47], null],
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], null],
    ['texto', [0x68, 0x65, 0x6c, 0x6c, 0x6f], null],
    ['vazio', [], null],
    ['JPEG com 2 bytes', [0xff, 0xd8], null],
  ])('%s', (_name, bytes, expected) => {
    expect(detectImageType(Uint8Array.from(bytes))).toBe(expected);
  });
});

describe('isValidServiceKey', () => {
  const digests = ['alfa', 'beta'].map((k) => createHash('sha256').update(k).digest());
  it('aceita qualquer chave da lista e recusa as demais', () => {
    expect(isValidServiceKey('alfa', digests)).toBe(true);
    expect(isValidServiceKey('beta', digests)).toBe(true);
    expect(isValidServiceKey('gama', digests)).toBe(false);
    expect(isValidServiceKey('', digests)).toBe(false);
  });
});

describe('formatServerTiming', () => {
  it('omite etapas ausentes', () => {
    expect(formatServerTiming({ validate: 1.2, total: 5 })).toBe('validate;dur=1.2, total;dur=5');
    expect(
      formatServerTiming({ validate: 1, candidates: 0.3, engineRoundTrip: 45.1, engineProcessing: 40, dbInsert: 2.1, total: 50.3 }),
    ).toBe('validate;dur=1, candidates;dur=0.3, engine;dur=45.1, engine-processing;dur=40, db;dur=2.1, total;dur=50.3');
  });
});
