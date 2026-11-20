import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  canonicalString,
  computeRecordHash,
  GENESIS_HASH,
  type HashableRecord,
  isHashTimestamp,
  toHashTimestamp,
} from '../src/nsr/hash';

const base: HashableRecord = {
  nsr: 42,
  tipo: '7',
  marcadoEm: '2026-11-20T12:00:00.123Z',
  cpf: '12345678901',
  gravadoEm: '2026-11-20T12:00:01.456Z',
  tipoColetor: '01',
  ehOffline: false,
};
const prev = Buffer.alloc(32, 0xab);

describe('hash', () => {
  it('é determinístico e tem 32 bytes', () => {
    const a = computeRecordHash(base, prev);
    expect(a.equals(computeRecordHash({ ...base }, Buffer.from(prev)))).toBe(true);
    expect(a.length).toBe(32);
  });

  it.each<[string, Partial<HashableRecord>]>([
    ['nsr', { nsr: 43 }],
    ['tipo', { tipo: '2', cpf: null }],
    ['marcadoEm', { marcadoEm: '2026-11-20T12:00:00.124Z' }],
    ['cpf', { cpf: '12345678902' }],
    ['gravadoEm', { gravadoEm: '2026-11-20T12:00:01.457Z' }],
    ['tipoColetor', { tipoColetor: '02' }],
    ['ehOffline', { ehOffline: true }],
  ])('mudar %s muda o hash', (_n, patch) => {
    expect(computeRecordHash({ ...base, ...patch }, prev).equals(computeRecordHash(base, prev))).toBe(false);
  });

  it('mudar previousHash muda o hash', () => {
    expect(computeRecordHash(base, Buffer.alloc(32, 0xac)).equals(computeRecordHash(base, prev))).toBe(false);
  });

  it('GENESIS_HASH tem 32 zeros', () => {
    expect(GENESIS_HASH.length).toBe(32);
    expect(GENESIS_HASH.every((b) => b === 0)).toBe(true);
  });

  it('rejeita entradas inválidas', () => {
    expect(() => computeRecordHash(base, Buffer.alloc(31))).toThrow();
    expect(() => computeRecordHash({ ...base, marcadoEm: '2026-11-20T12:00:00Z' }, prev)).toThrow();
    expect(() => computeRecordHash({ ...base, gravadoEm: '2026-11-20T12:00:00.123456Z' }, prev)).toThrow();
    expect(() => computeRecordHash({ ...base, nsr: 0 }, prev)).toThrow();
    expect(() => computeRecordHash({ ...base, nsr: 1.5 }, prev)).toThrow();
    expect(() => computeRecordHash({ ...base, cpf: '' }, prev)).toThrow();
    expect(() => computeRecordHash({ ...base, cpf: null }, prev)).toThrow();
  });

  it("aceita cpf nulo no tipo '2'", () => {
    expect(computeRecordHash({ ...base, tipo: '2', cpf: null }, prev).length).toBe(32);
  });

  it('formata e valida timestamps', () => {
    const t = toHashTimestamp(new Date('2026-11-20T12:00:00Z'));
    expect(t).toBe('2026-11-20T12:00:00.000Z');
    expect(isHashTimestamp(t)).toBe(true);
    expect(isHashTimestamp('2026-02-30T12:00:00.000Z')).toBe(false);
  });
});

// Vetor de ouro: string montada à mão, sem canonicalString.
const GOLDEN_STRING =
  '42|7|2026-11-20T12:00:00.123Z|12345678901|2026-11-20T12:00:01.456Z|01|false|' + '00'.repeat(32);
const GOLDEN_HEX = createHash('sha256').update(GOLDEN_STRING, 'utf8').digest('hex');

describe('vetor de ouro', () => {
  it('computeRecordHash bate com a montagem independente', () => {
    expect(canonicalString(base, GENESIS_HASH)).toBe(GOLDEN_STRING);
    expect(computeRecordHash(base, GENESIS_HASH).toString('hex')).toBe(GOLDEN_HEX);
  });

  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'python', 'check_hash.py');
  const candidates: Array<[string, string[]]> = [['py', ['-3']], ['python3', []], ['python', []]];
  let py: [string, string[]] | null = null;
  for (const [cmd, pre] of candidates) {
    if (spawnSync(cmd, [...pre, '-I', '-c', 'import hashlib'], { encoding: 'utf8' }).status === 0) {
      py = [cmd, pre];
      break;
    }
  }
  it.skipIf(!py)(
    py ? 'hashlib (Python) calcula o mesmo hash' : 'NÃO verificado: Python indisponível, vetor cruzado pulado', () => {
    const [cmd, pre] = py!;
    const r = spawnSync(cmd, [...pre, '-I', script], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(GOLDEN_HEX);
  });
});
