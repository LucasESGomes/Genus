import { describe, expect, it } from 'vitest';
import {
  classifyHealthBody,
  classifyJobs,
  classifyLatency,
  classifyRepCore,
  combineProbe,
  JOBS_DEGRADED_AGE_S,
  JOBS_DEGRADED_WAITING,
  JOBS_DOWN_AGE_S,
  PROBE_SLOW_MS,
  REP_CORE_DEGRADED_AGE_S,
  REP_CORE_DEGRADED_WAITING,
  REP_CORE_DOWN_AGE_S,
  worstOf,
  type HealthState,
} from './classify-health';

describe('worstOf', () => {
  it.each<[HealthState[], HealthState]>([
    [[], 'ok'],
    [['ok', 'ok'], 'ok'],
    [['ok', 'degraded'], 'degraded'],
    [['degraded', 'down', 'ok'], 'down'],
  ])('%j -> %s', (states, expected) => expect(worstOf(states)).toBe(expected));
});

describe('classifyLatency', () => {
  it.each<[number, HealthState]>([
    [0, 'ok'],
    [PROBE_SLOW_MS, 'ok'],
    [PROBE_SLOW_MS + 1, 'degraded'],
  ])('%d ms -> %s', (ms, expected) => expect(classifyLatency(ms)).toBe(expected));
});

describe('classifyRepCore', () => {
  it.each<[number | null, number | null, HealthState]>([
    [null, null, 'ok'],
    [null, 0, 'ok'],
    [REP_CORE_DEGRADED_AGE_S, 0, 'ok'],
    [REP_CORE_DEGRADED_AGE_S + 1, 0, 'degraded'],
    [REP_CORE_DOWN_AGE_S, 0, 'degraded'],
    [REP_CORE_DOWN_AGE_S + 1, 0, 'down'],
    [null, REP_CORE_DEGRADED_WAITING, 'ok'],
    [null, REP_CORE_DEGRADED_WAITING + 1, 'degraded'],
    [5, null, 'ok'],
  ])('idade %s, esperando %s -> %s', (age, waiting, expected) =>
    expect(classifyRepCore({ oldestPendingAgeSeconds: age, waiting })).toBe(expected));
});

describe('classifyJobs', () => {
  it.each<[number | null, number | null, HealthState]>([
    [null, null, 'ok'],
    [JOBS_DEGRADED_AGE_S, 0, 'ok'],
    [JOBS_DEGRADED_AGE_S + 1, 0, 'degraded'],
    [JOBS_DOWN_AGE_S + 1, 0, 'down'],
    [null, JOBS_DEGRADED_WAITING + 1, 'degraded'],
    [JOBS_DOWN_AGE_S + 1, JOBS_DEGRADED_WAITING + 1, 'down'],
  ])('idade %s, esperando %s -> %s', (age, waiting, expected) =>
    expect(classifyJobs({ oldestPendingAgeSeconds: age, waiting })).toBe(expected));
});

describe('classifyHealthBody', () => {
  it.each<[unknown, HealthState]>([
    [{ status: 'ok', models: {} }, 'ok'],
    [{ status: 'degraded' }, 'degraded'],
    [{ data: { status: 'ok' } }, 'ok'],
    [{ data: { status: 'degraded' } }, 'degraded'],
    [{ data: { status: 'down' } }, 'down'],
    [{}, 'degraded'],
    ['texto', 'degraded'],
    [null, 'degraded'],
  ])('%j -> %s', (body, expected) => expect(classifyHealthBody(body)).toBe(expected));
});

describe('combineProbe', () => {
  it('lento rebaixa um ok', () => expect(combineProbe('ok', 1500)).toBe('degraded'));
  it('down continua down', () => expect(combineProbe('down', 10)).toBe('down'));
});
