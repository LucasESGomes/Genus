import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../src/config/env';

const MASTER = 'ab'.repeat(32);
const LONG_KEY = 'k'.repeat(40);

function base(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    APP_ENV: 'dev',
    ARP_DATABASE_URL: 'postgres://u:senha-secreta@localhost:5432/arp',
    ENGINE_URL: 'http://localhost:8001',
    ENGINE_API_KEY: 'engine-key-secreta',
    MASTER_KEY: MASTER,
    COLLECTOR_SERVICE_KEYS: 'curta',
    FAKE_CANDIDATES_ENABLED: 'true',
    DEV_TENANT_ID: '1',
    DEV_ESTABLISHMENT_ID: '1',
    DEV_DEVICE_ID: '1',
    ...over,
  };
}

const prod = (over: Record<string, string | undefined> = {}) =>
  base({ APP_ENV: 'prod', FAKE_CANDIDATES_ENABLED: 'false', COLLECTOR_SERVICE_KEYS: LONG_KEY, ...over });

describe('loadEnv', () => {
  it('aplica padrões', () => {
    const env = loadEnv(base());
    expect(env).toMatchObject({
      port: 3001,
      engineTimeoutMs: 800,
      engineMaxConcurrency: 4,
      maxImageBytes: 1_048_576,
      fakeCandidatesCount: 20,
      exposeTimings: false,
      fakeCandidatesEnabled: true,
    });
  });

  it('LOG_LEVEL padrão por ambiente', () => {
    expect(loadEnv(base()).logLevel).toBe('debug');
    expect(loadEnv(base({ APP_ENV: 'homolog' })).logLevel).toBe('info');
    expect(loadEnv(prod()).logLevel).toBe('info');
    expect(loadEnv(base({ LOG_LEVEL: 'warn' })).logLevel).toBe('warn');
  });

  it('lista de chaves: trim, sem vazias, rotação', () => {
    const env = loadEnv(base({ COLLECTOR_SERVICE_KEYS: ' a ,, b ,' }));
    expect(env.serviceKeys).toEqual(['a', 'b']);
  });

  it('placeholder TROQUE_ dos arquivos de exemplo é recusado em qualquer ambiente', () => {
    expect(() => loadEnv(base({ COLLECTOR_SERVICE_KEYS: 'TROQUE_CHAVE_SERVICO_ATUAL' }))).toThrow(EnvError);
    expect(() => loadEnv(base({ ENGINE_API_KEY: 'TROQUE_ENGINE_API_KEY' }))).toThrow(/ENGINE_API_KEY/);
  });

  it('prod com FAKE_CANDIDATES_ENABLED=true lança', () => {
    expect(() => loadEnv(prod({ FAKE_CANDIDATES_ENABLED: 'true' }))).toThrow(EnvError);
  });

  it('prod com EXPOSE_TIMINGS=true lança', () => {
    expect(() => loadEnv(prod({ EXPOSE_TIMINGS: 'true' }))).toThrow(/EXPOSE_TIMINGS/);
  });

  it('prod com chave de serviço curta lança', () => {
    expect(() => loadEnv(prod({ COLLECTOR_SERVICE_KEYS: `${LONG_KEY},curta` }))).toThrow(/COLLECTOR_SERVICE_KEYS/);
  });

  it('prod válido sobe; dev aceita chave curta e timings', () => {
    expect(loadEnv(prod()).appEnv).toBe('prod');
    expect(loadEnv(base({ EXPOSE_TIMINGS: 'true' })).exposeTimings).toBe(true);
  });

  it('fila: padrões, URL sem senha e senha obrigatória fora de dev', () => {
    expect(loadEnv(base())).toMatchObject({
      valkeyUrl: undefined,
      valkeyPassword: undefined,
      queuePublishTimeoutMs: 250,
      queueAttempts: 5,
    });
    const withQueue = loadEnv(base({ VALKEY_URL: 'redis://localhost:6379', QUEUE_PUBLISH_TIMEOUT_MS: '100' }));
    expect(withQueue).toMatchObject({ valkeyUrl: 'redis://localhost:6379', queuePublishTimeoutMs: 100 });
    expect(() => loadEnv(base({ VALKEY_URL: 'redis://:senha-vazada@localhost:6379' }))).toThrow(/VALKEY_URL/);
    expect(() => loadEnv(base({ VALKEY_URL: 'http://localhost' }))).toThrow(/VALKEY_URL/);
    expect(() => loadEnv(prod({ VALKEY_URL: 'rediss://valkey:6379' }))).toThrow(/VALKEY_PASSWORD/);
    expect(() => loadEnv(base({ APP_ENV: 'homolog', VALKEY_URL: 'redis://valkey:6379' }))).toThrow(/VALKEY_PASSWORD/);
    expect(loadEnv(prod({ VALKEY_URL: 'rediss://valkey:6379', VALKEY_PASSWORD: 'x' })).valkeyPassword).toBe('x');
  });

  it('booleano estrito e inteiros positivos', () => {
    expect(() => loadEnv(base({ FAKE_CANDIDATES_ENABLED: 'TRUE' }))).toThrow(/FAKE_CANDIDATES_ENABLED/);
    expect(() => loadEnv(base({ FAKE_CANDIDATES_ENABLED: '1' }))).toThrow(EnvError);
    expect(() => loadEnv(base({ DEV_TENANT_ID: '0' }))).toThrow(/DEV_TENANT_ID/);
    expect(() => loadEnv(base({ PORT: 'abc' }))).toThrow(/PORT/);
  });

  it('MASTER_KEY precisa de 64 hex; APP_ENV é obrigatório', () => {
    expect(() => loadEnv(base({ MASTER_KEY: 'zz' }))).toThrow(/MASTER_KEY/);
    expect(() => loadEnv(base({ APP_ENV: undefined }))).toThrow(/APP_ENV/);
  });

  it('a mensagem de erro lista variáveis mas não imprime valores', () => {
    let message = '';
    try {
      loadEnv(base({ MASTER_KEY: 'segredo-invalido-xyz', ENGINE_API_KEY: undefined, PORT: 'valor-secreto' }));
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/MASTER_KEY/);
    expect(message).toMatch(/ENGINE_API_KEY/);
    for (const secret of ['segredo-invalido-xyz', 'valor-secreto', 'senha-secreta']) {
      expect(message).not.toContain(secret);
    }
  });
});

describe('server.ts', () => {
  it('APP_ENV=prod com FAKE_CANDIDATES_ENABLED=true: o processo termina com código diferente de zero', () => {
    const appDir = fileURLToPath(new URL('../', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      cwd: appDir,
      env: {
        // Ambiente mínimo e limpo: não herda nenhum .env.
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        ...(prod({ FAKE_CANDIDATES_ENABLED: 'true' }) as Record<string, string>),
      },
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(result.status).not.toBe(0);
    expect(result.status).not.toBeNull();
    expect(result.stderr).toContain('FAKE_CANDIDATES_ENABLED');
    expect(result.stderr).not.toContain('senha-secreta');
  }, 40_000);
});
