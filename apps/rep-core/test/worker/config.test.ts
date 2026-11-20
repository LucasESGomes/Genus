import { describe, expect, it } from 'vitest';
import { loadRepCoreConfig, RepCoreConfigError } from '../../src/config/env';

const base = {
  ARP_CORE_DATABASE_URL: 'postgres://arp_core:segredo-do-banco@localhost:5432/arp',
  VALKEY_URL: 'redis://localhost:6379',
};

function errorOf(source: Record<string, string | undefined>): RepCoreConfigError {
  try {
    loadRepCoreConfig(source);
  } catch (err) {
    if (err instanceof RepCoreConfigError) return err;
    throw err;
  }
  throw new Error('esperava erro de configuração');
}

describe('loadRepCoreConfig', () => {
  it('D8: em dev passa sem senha do Valkey e aplica os padrões', () => {
    const cfg = loadRepCoreConfig({ ...base, APP_ENV: 'dev' });
    expect(cfg.concurrency).toBe(4);
    expect(cfg.poolMax).toBe(8);
    expect(cfg.queue.attempts).toBe(5);
    expect(cfg.queue.publishTimeoutMs).toBe(250);
    expect(cfg.queue.password).toBeUndefined();
  });

  it('D8: em homolog e prod a ausência da senha falha, citando só o nome da variável', () => {
    for (const appEnv of ['homolog', 'prod']) {
      const err = errorOf({ ...base, APP_ENV: appEnv });
      expect(err.variables).toEqual(['VALKEY_PASSWORD']);
    }
    expect(() => loadRepCoreConfig({ ...base, APP_ENV: 'homolog', VALKEY_PASSWORD: 'x' })).not.toThrow();
  });

  it('aceita APP_ENV=test sem senha e recusa ambiente desconhecido', () => {
    expect(() => loadRepCoreConfig({ ...base, APP_ENV: 'test' })).not.toThrow();
    expect(errorOf({ ...base, APP_ENV: 'staging' }).variables).toEqual(['APP_ENV']);
  });

  it('WORKER_CONCURRENCY precisa estar entre 1 e 32', () => {
    expect(loadRepCoreConfig({ ...base, APP_ENV: 'dev', WORKER_CONCURRENCY: '32' }).poolMax).toBe(36);
    for (const bad of ['0', '33', '2.5', 'abc']) {
      expect(errorOf({ ...base, APP_ENV: 'dev', WORKER_CONCURRENCY: bad }).variables).toEqual(['WORKER_CONCURRENCY']);
    }
  });

  it('banco obrigatório e URL do Valkey sem senha embutida; erro não vaza valores', () => {
    expect(errorOf({ APP_ENV: 'dev', VALKEY_URL: base.VALKEY_URL }).variables).toEqual(['ARP_CORE_DATABASE_URL']);
    const err = errorOf({ ...base, APP_ENV: 'dev', VALKEY_URL: 'redis://:senha-vazada@localhost:6379' });
    expect(err.variables).toEqual(['VALKEY_URL']);
    expect(err.message).not.toContain('senha-vazada');
    const err2 = errorOf({ ...base, APP_ENV: 'prod' });
    expect(err2.message).not.toContain('segredo-do-banco');
  });
});
