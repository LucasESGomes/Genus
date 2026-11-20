/**
 * Integração com Valkey real (Testcontainers). Exige Docker.
 */
import { createServer } from 'node:net';
import { createLogger } from '@genus/shared';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createProducerConnection,
  createQueuePublisher,
  PUNCHES_QUEUE,
  punchJobId,
  VALKEY_IMAGE,
  type ClosableQueuePublisher,
} from '../src/index';

const PASSWORD = 'senha-de-teste-do-valkey';
let container: StartedTestContainer;
let url: string;
let inspector: Redis;
const cleanups: (() => Promise<void>)[] = [];

const logLines: string[] = [];
const logger = createLogger({
  level: 'debug',
  service: 'queue-test',
  destination: { write: (chunk: string) => void logLines.push(chunk) },
});

function newPublisher(opts: { url?: string; password?: string; timeoutMs?: number } = {}): ClosableQueuePublisher {
  const timeoutMs = opts.timeoutMs ?? 250;
  const connection = createProducerConnection({
    url: opts.url ?? url,
    password: 'password' in opts ? opts.password : PASSWORD,
    publishTimeoutMs: timeoutMs,
  });
  const publisher = createQueuePublisher({ connection, logger, timeoutMs });
  cleanups.push(() => publisher.close());
  return publisher;
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('sem porta');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

beforeAll(async () => {
  container = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withCommand(['valkey-server', '--requirepass', PASSWORD, '--maxmemory-policy', 'noeviction', '--appendonly', 'yes', '--appendfsync', 'everysec'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  url = `redis://${container.getHost()}:${container.getMappedPort(6379)}`;
  inspector = new Redis(url, { password: PASSWORD, maxRetriesPerRequest: null });
}, 120_000);

afterAll(async () => {
  for (const cleanup of cleanups) await cleanup().catch(() => undefined);
  inspector?.disconnect();
  await container?.stop();
});

const entry = { entryId: 11, tenantId: 1, establishmentId: 10, deviceId: 100, deviceSequence: 5 };

describe('createQueuePublisher com Valkey no ar', () => {
  it('publica em punches com o jobId esperado e payload só com IDs', async () => {
    const publisher = newPublisher();
    expect(await publisher.ping()).toBe(true);
    await publisher.publishPunch(entry);

    const job = await publisher.queue.getJob(punchJobId(100, 5));
    expect(job).toBeDefined();
    expect(job?.id).toBe('100-5');
    expect(job?.name).toBe('punch');
    expect(job?.data).toEqual({ entryId: 11, tenantId: 1, establishmentId: 10 });
    expect(job?.opts.attempts).toBe(5);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 1000 });
    expect(job?.opts.removeOnFail).toBe(false);
    // O nome da fila no Valkey.
    expect(await inspector.exists(`bull:${PUNCHES_QUEUE}:100-5`)).toBe(1);
  });

  it('publicar duas vezes o mesmo jobId não cria dois jobs', async () => {
    const publisher = newPublisher();
    const same = { ...entry, entryId: 22, deviceSequence: 6 };
    await publisher.publishPunch(same);
    await publisher.publishPunch(same);
    const counts = await publisher.queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    const jobs = await publisher.queue.getJobs(['waiting', 'delayed', 'active']);
    expect(jobs.filter((j) => j.id === '100-6')).toHaveLength(1);
    expect(counts.waiting).toBeGreaterThanOrEqual(1);
  });

  it('recusa entrada inválida antes de tocar a fila', async () => {
    const publisher = newPublisher();
    await expect(publisher.publishPunch({ ...entry, deviceSequence: 0 })).rejects.toThrow();
    await expect(publisher.publishPunch({ ...entry, entryId: 1.5 })).rejects.toThrow();
  });
});

describe('Valkey fora ou com senha errada', () => {
  it('porta fechada: publishPunch lança dentro do prazo e não pendura; ping devolve false', async () => {
    const timeoutMs = 250;
    const publisher = newPublisher({ url: `redis://127.0.0.1:${await closedPort()}`, timeoutMs });

    const startedAt = performance.now();
    await expect(publisher.publishPunch(entry)).rejects.toThrow();
    expect(performance.now() - startedAt).toBeLessThan(timeoutMs + 500);

    const pingStartedAt = performance.now();
    expect(await publisher.ping()).toBe(false);
    expect(performance.now() - pingStartedAt).toBeLessThan(timeoutMs + 500);
  });

  it('senha errada: ping e publishPunch falham', async () => {
    const publisher = newPublisher({ password: 'senha-errada' });
    expect(await publisher.ping()).toBe(false);
    await expect(publisher.publishPunch(entry)).rejects.toThrow();
  });

  it('sem senha contra servidor com senha: falha', async () => {
    const publisher = newPublisher({ password: undefined });
    expect(await publisher.ping()).toBe(false);
    await expect(publisher.publishPunch(entry)).rejects.toThrow();
  });

  it('o log de erro de conexão nunca contém URL nem senha', async () => {
    const publisher = newPublisher({ password: 'senha-errada-vazavel' });
    await publisher.ping();
    const text = logLines.join('\n');
    expect(text).not.toContain('senha-errada-vazavel');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('redis://');
  });
});
