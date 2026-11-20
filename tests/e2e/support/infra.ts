/**
 * Infraestrutura dos testes ponta a ponta: Postgres (migrations reais, papéis reais),
 * Valkey (Testcontainers) e o stub HTTP da engine do coletor. Cada arquivo de teste
 * sobe a sua e derruba no fim.
 */
import { createServer, connect, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { VALKEY_IMAGE } from '@genus/queue';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { startEngineStub, type EngineStub } from '../../../apps/collector-api/test/support/engine-stub';

export const ENGINE_API_KEY = 'chave-da-engine-e2e-0123456789';
export const MASTER_KEY = randomBytes(32).toString('hex');

export interface ValkeyHandle {
  url: string;
  host: string;
  port: number;
  stop(): Promise<void>;
}

export async function startValkey(): Promise<ValkeyHandle> {
  const container: StartedTestContainer = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withCommand(['valkey-server', '--maxmemory-policy', 'noeviction'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  const host = container.getHost();
  const port = container.getMappedPort(6379);
  return { url: `redis://${host}:${port}`, host, port, stop: async () => void (await container.stop()) };
}

/**
 * Proxy TCP que liga e desliga na MESMA porta. Serve para simular "Valkey fora do ar" só
 * para um cliente (a API do coletor, ou o publicador de `post-punch` do worker), sem
 * parar o container nem mudar a porta mapeada que os outros clientes usam.
 * Desligado: a porta recusa conexão e as conexões abertas são derrubadas.
 */
export class ToggleProxy {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
    readonly port: number,
  ) {}

  static async create(target: { host: string; port: number }, initiallyUp: boolean): Promise<ToggleProxy> {
    // Descobre uma porta livre e a reserva para o ciclo desligar/ligar.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const address = probe.address();
    if (!address || typeof address === 'string') throw new Error('sem porta para o proxy');
    const port = address.port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const proxy = new ToggleProxy(target.host, target.port, port);
    if (initiallyUp) await proxy.up();
    return proxy;
  }

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  async up(): Promise<void> {
    if (this.server) return;
    const server = createServer((client) => {
      const upstream = connect(this.targetPort, this.targetHost);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on('close', () => this.sockets.delete(s));
        s.on('error', () => s.destroy());
      }
      client.pipe(upstream);
      upstream.pipe(client);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, '127.0.0.1', () => resolve());
    });
    this.server = server;
  }

  async down(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export interface Infra {
  db: ArpTestDatabase;
  /** `arp_owner`: só para semear, instalar triggers de falha e ler tudo nas asserções. */
  owner: pg.Pool;
  /** `arp_core`: pool do worker do rep-core. */
  core: pg.Pool;
  /** `arp_reader`: resgate e verificação da cadeia. */
  reader: pg.Pool;
  valkey: ValkeyHandle;
  engine: EngineStub;
  stop(): Promise<void>;
}

export async function startInfra(opts: { corePoolMax?: number } = {}): Promise<Infra> {
  const [db, valkey, engine] = await Promise.all([
    startArpTestDatabase(),
    startValkey(),
    startEngineStub({ apiKey: ENGINE_API_KEY, masterKeyHex: MASTER_KEY }),
  ]);
  const owner = new pg.Pool({ connectionString: db.ownerUrl, max: 4 });
  const core = new pg.Pool({ connectionString: db.coreUrl, max: opts.corePoolMax ?? 12 });
  const reader = new pg.Pool({ connectionString: db.readerUrl, max: 3 });
  for (const p of [owner, core, reader]) p.on('error', () => undefined);
  return {
    db,
    owner,
    core,
    reader,
    valkey,
    engine,
    stop: async () => {
      await Promise.allSettled([owner.end(), core.end(), reader.end()]);
      await engine.close();
      await valkey.stop();
      await db.stop();
    },
  };
}

/** Conexão de inspeção/resgate: produtora do `@genus/queue`, já pronta. */
export async function waitReady(conn: Redis): Promise<void> {
  if (conn.status === 'ready') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Valkey não ficou pronto')), 10_000);
    conn.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Remove todos os jobs das duas filas (os nomes são fixos entre testes do mesmo arquivo). */
export async function resetQueues(valkeyUrl: string): Promise<void> {
  const conn = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
  try {
    for (const name of ['punches', 'post-punch']) {
      const q = new Queue(name, { connection: conn });
      await q.obliterate({ force: true });
      await q.close();
    }
  } finally {
    conn.disconnect();
  }
}

/**
 * Deixa o banco sem pendências de testes anteriores, para o resgate (que varre todas as
 * contas e estabelecimentos) só enxergar o cenário atual. Não toca em `registros` nem
 * `evidencias` (só INSERT): apaga entradas ainda `pendente` (sem evidência) e marca o
 * outbox pendente como `processado`.
 */
export async function quiesce(owner: pg.Pool): Promise<void> {
  await owner.query(`DELETE FROM entradas WHERE status IN ('pendente', 'falhou')`);
  await owner.query(`UPDATE outbox SET status = 'processado', processado_em = now() WHERE status = 'pendente'`);
}

export async function scalar(owner: pg.Pool, sql: string, params: unknown[] = []): Promise<number> {
  const res = await owner.query<{ n: string }>(sql, params);
  return Number(res.rows[0]?.n ?? 0);
}

/** Repete `check` até devolver verdadeiro ou estourar o prazo. */
export async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 30_000): Promise<void> {
  const started = performance.now();
  for (;;) {
    if (await check()) return;
    if (performance.now() - started > timeoutMs) throw new Error(`Prazo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
