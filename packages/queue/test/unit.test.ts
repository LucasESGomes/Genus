import { describe, expect, it } from 'vitest';
import {
  defaultJobOptions,
  loadQueueConfig,
  postPunchJobId,
  postPunchPayloadSchema,
  parsePunchJobId,
  punchJobId,
  punchPayloadSchema,
  postPunchJobOptions,
  punchesJobOptions,
  QueueConfigError,
} from '../src/index';

describe('jobId', () => {
  it('punches e post-punch usam só "-"', () => {
    expect(punchJobId(100, 7)).toBe('100-7');
    expect(postPunchJobId('recalculate-day', 10, 42)).toBe('recalculate-day-10-42');
  });

  it('parsePunchJobId é o inverso de punchJobId e recusa o resto', () => {
    expect(parsePunchJobId(punchJobId(100, 7))).toEqual({ deviceId: 100, deviceSequence: 7 });
    for (const bad of ['', '100', '100-', '0-1', '1-0', '01-1', 'a-1', '1-2-3', '-1-2', '99999999999999999-1']) {
      expect(parsePunchJobId(bad)).toBeNull();
    }
  });

  it('recusa inteiros inválidos e evento desconhecido', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => punchJobId(bad, 1)).toThrow(RangeError);
      expect(() => punchJobId(1, bad)).toThrow(RangeError);
      expect(() => postPunchJobId('official-qr', bad, 1)).toThrow(RangeError);
      expect(() => postPunchJobId('official-qr', 1, bad)).toThrow(RangeError);
    }
    expect(() => postPunchJobId('outro', 1, 1)).toThrow(RangeError);
  });
});

describe('payloads', () => {
  it('aceitam só IDs inteiros positivos seguros', () => {
    expect(punchPayloadSchema.parse({ entryId: 1, tenantId: 2, establishmentId: 3 })).toEqual({
      entryId: 1,
      tenantId: 2,
      establishmentId: 3,
    });
    expect(postPunchPayloadSchema.safeParse({ outboxId: 1, tenantId: 2, establishmentId: 3, nsr: 4 }).success).toBe(true);
    expect(punchPayloadSchema.safeParse({ entryId: 0, tenantId: 2, establishmentId: 3 }).success).toBe(false);
    expect(punchPayloadSchema.safeParse({ entryId: 2 ** 53, tenantId: 2, establishmentId: 3 }).success).toBe(false);
    expect(punchPayloadSchema.safeParse({ entryId: 1.5, tenantId: 2, establishmentId: 3 }).success).toBe(false);
  });

  it('recusam campos extras (nada de CPF ou dado pessoal no job)', () => {
    expect(punchPayloadSchema.safeParse({ entryId: 1, tenantId: 2, establishmentId: 3, cpf: '123' }).success).toBe(false);
  });
});

describe('opções de job', () => {
  it('padrões da especificação', () => {
    expect(defaultJobOptions()).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnFail: false,
    });
    expect(defaultJobOptions(3).attempts).toBe(3);
    expect(punchesJobOptions().removeOnComplete).toEqual({ age: 86_400, count: 10_000 });
    expect(postPunchJobOptions().removeOnComplete).toBe(false);
    expect(postPunchJobOptions().removeOnFail).toBe(false);
  });
});

describe('loadQueueConfig', () => {
  it('padrões em dev, senha opcional', () => {
    expect(loadQueueConfig({ APP_ENV: 'dev', VALKEY_URL: 'redis://localhost:6379' })).toEqual({
      url: 'redis://localhost:6379',
      password: undefined,
      publishTimeoutMs: 250,
      attempts: 5,
    });
  });

  it('senha obrigatória fora de dev/test, sem vazar valores', () => {
    for (const appEnv of ['homolog', 'prod']) {
      expect(() => loadQueueConfig({ APP_ENV: appEnv, VALKEY_URL: 'redis://localhost:6379' })).toThrow(QueueConfigError);
    }
    expect(loadQueueConfig({ APP_ENV: 'prod', VALKEY_URL: 'rediss://valkey:6379', VALKEY_PASSWORD: 'segredo' }).password).toBe('segredo');
    expect(loadQueueConfig({ APP_ENV: 'test', VALKEY_URL: 'redis://localhost:6379' }).password).toBeUndefined();
  });

  it('recusa URL com senha, protocolo errado e números inválidos, sem citar o valor', () => {
    let message = '';
    try {
      loadQueueConfig({ APP_ENV: 'dev', VALKEY_URL: 'redis://:senha-vazada@localhost:6379' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('VALKEY_URL');
    expect(message).not.toContain('senha-vazada');
    expect(() => loadQueueConfig({ APP_ENV: 'dev', VALKEY_URL: 'http://localhost' })).toThrow(QueueConfigError);
    expect(() => loadQueueConfig({ APP_ENV: 'dev', VALKEY_URL: 'redis://h:1', QUEUE_ATTEMPTS: '0' })).toThrow(QueueConfigError);
    expect(() => loadQueueConfig({ APP_ENV: 'dev' })).toThrow(/VALKEY_URL/);
  });
});
