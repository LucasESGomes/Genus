import { describe, expect, it } from 'vitest';
import { JobsConfigError, loadJobsConfig } from '../src/config';

const base = {
  ARP_READER_DATABASE_URL: 'postgres://arp_reader:segredo-do-banco@localhost:5432/arp',
  VALKEY_URL: 'redis://localhost:6379',
};

describe('loadJobsConfig', () => {
  it('aplica os padrões em dev sem senha do Valkey', () => {
    const cfg = loadJobsConfig({ ...base, APP_ENV: 'dev' });
    expect(cfg).toMatchObject({ intervalMs: 20_000, minAgeMs: 30_000, postPunchDepthWarn: 10_000, attempts: 5 });
    expect(cfg.valkeyPassword).toBeUndefined();
  });

  it('exige a senha do Valkey em homolog e prod, citando só o nome', () => {
    for (const appEnv of ['homolog', 'prod']) {
      try {
        loadJobsConfig({ ...base, APP_ENV: appEnv });
        throw new Error('esperava erro');
      } catch (err) {
        expect(err).toBeInstanceOf(JobsConfigError);
        expect((err as JobsConfigError).variables).toEqual(['VALKEY_PASSWORD']);
        expect((err as JobsConfigError).message).not.toContain('segredo-do-banco');
      }
    }
  });

  it('valida inteiros e o banco obrigatório', () => {
    expect(() => loadJobsConfig({ ...base, APP_ENV: 'dev', RESCUE_MIN_AGE_MS: '0' })).toThrow(JobsConfigError);
    expect(() => loadJobsConfig({ APP_ENV: 'dev', VALKEY_URL: base.VALKEY_URL })).toThrow(JobsConfigError);
  });
});
