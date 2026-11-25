import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { createLogger, FixedClock } from '@genus/shared';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbDeviceAuthenticator } from '../src/auth/db-device-authenticator';
import { HttpError } from '../src/plugins/error-handler';
import { createAppTestDatabase, seedDevice, type AppTestDatabase } from './support/app-db';

const silent = createLogger({ level: 'silent', service: 'test' });
let arp: ArpTestDatabase;
let app: AppTestDatabase;
let reader: pg.Pool;
let queries = 0;
let clock: FixedClock;

/** Pool do papel de leitura, contando as consultas. */
const countingPool = (): Pick<pg.Pool, 'query'> =>
  ({
    query: (...args: unknown[]) => {
      queries++;
      return (reader.query as (...a: unknown[]) => unknown)(...args);
    },
  }) as Pick<pg.Pool, 'query'>;

const KEY = 'gk_' + 'a'.repeat(40);
const headers = (key?: string) => ({ headers: key === undefined ? {} : { 'x-device-key': key } });

beforeAll(async () => {
  arp = await startArpTestDatabase();
  app = await createAppTestDatabase(arp);
  reader = new pg.Pool({ connectionString: app.readerUrl, max: 2 });
}, 120_000);

afterAll(async () => {
  await reader?.end();
  await app?.stop();
  await arp?.stop();
});

beforeEach(async () => {
  await app.admin.query('TRUNCATE rh.aparelhos');
  queries = 0;
  clock = new FixedClock('2026-11-25T12:00:00.000Z');
});

async function rejection(promise: Promise<unknown>): Promise<HttpError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

describe('DbDeviceAuthenticator', () => {
  it('chave válida devolve o contexto do aparelho e os limiares', async () => {
    const deviceId = await seedDevice(app, { tenantId: 7, establishmentId: 70, key: KEY, recognition: 0.9, liveness: 0.7 });
    const auth = new DbDeviceAuthenticator({ pool: countingPool(), clock, logger: silent });
    const ctx = await auth.resolve(headers(KEY));
    expect(ctx).toMatchObject({ tenantId: 7, establishmentId: 70, deviceId });
    expect(ctx.recognitionThreshold).toBeCloseTo(0.9, 5);
    expect(ctx.livenessThreshold).toBeCloseTo(0.7, 5);
  });

  it('limiares NULL viram null (padrão da engine)', async () => {
    await seedDevice(app, { tenantId: 1, establishmentId: 1, key: KEY });
    const auth = new DbDeviceAuthenticator({ pool: countingPool(), clock, logger: silent });
    const ctx = await auth.resolve(headers(KEY));
    expect(ctx.recognitionThreshold).toBeNull();
    expect(ctx.livenessThreshold).toBeNull();
  });

  it('chave errada, ausente, vazia e de aparelho inativo: 401 CHAVE_APARELHO_INVALIDA idêntico', async () => {
    await seedDevice(app, { tenantId: 1, establishmentId: 1, key: KEY });
    await seedDevice(app, { tenantId: 1, establishmentId: 1, key: 'gk_inativa', active: false });
    const auth = new DbDeviceAuthenticator({ pool: countingPool(), clock, logger: silent });
    const errors = [
      await rejection(auth.resolve(headers('gk_errada'))),
      await rejection(auth.resolve(headers())),
      await rejection(auth.resolve(headers('   '))),
      await rejection(auth.resolve(headers('gk_inativa'))),
    ];
    for (const e of errors) {
      expect(e.statusCode).toBe(401);
      expect(e.code).toBe('CHAVE_APARELHO_INVALIDA');
      expect(e.message).toBe(errors[0]?.message);
    }
  });

  it('cache: a segunda batida não vai ao banco; vence em 30 s e relê', async () => {
    await seedDevice(app, { tenantId: 1, establishmentId: 1, key: KEY });
    const auth = new DbDeviceAuthenticator({ pool: countingPool(), clock, logger: silent });
    await auth.resolve(headers(KEY));
    await auth.resolve(headers(KEY));
    expect(queries).toBe(1);

    // Desativado no banco: ainda vale dentro do TTL, deixa de valer depois.
    await app.admin.query('UPDATE rh.aparelhos SET ativo = false');
    clock.advance(29_000);
    await expect(auth.resolve(headers(KEY))).resolves.toBeDefined();
    clock.advance(2_000);
    expect((await rejection(auth.resolve(headers(KEY)))).code).toBe('CHAVE_APARELHO_INVALIDA');
    expect(queries).toBe(2);
  });

  it('chave inválida também fica em cache (curto) e depois relê', async () => {
    const auth = new DbDeviceAuthenticator({ pool: countingPool(), clock, logger: silent });
    await rejection(auth.resolve(headers('gk_chute')));
    await rejection(auth.resolve(headers('gk_chute')));
    expect(queries).toBe(1);
    // A chave passa a existir: depois do TTL negativo o aparelho entra.
    await seedDevice(app, { tenantId: 1, establishmentId: 1, key: 'gk_chute' });
    clock.advance(6_000);
    await expect(auth.resolve(headers('gk_chute'))).resolves.toBeDefined();
    expect(queries).toBe(2);
  });

  it('TTL configurado acima de 30 s é limitado a 30 s', async () => {
    await seedDevice(app, { tenantId: 1, establishmentId: 1, key: KEY });
    const auth = new DbDeviceAuthenticator({ pool: countingPool(), clock, logger: silent, ttlMs: 600_000 });
    await auth.resolve(headers(KEY));
    clock.advance(31_000);
    await auth.resolve(headers(KEY));
    expect(queries).toBe(2);
  });

  it('o papel de leitura não escreve e não lê colunas fora da lista', async () => {
    await expect(reader.query('UPDATE rh.aparelhos SET ativo = false')).rejects.toThrow();
    await expect(reader.query('SELECT pin_hash FROM rh.colaboradores')).rejects.toThrow();
    await expect(reader.query('SELECT nome FROM rh.aparelhos')).rejects.toThrow();
  });
});
