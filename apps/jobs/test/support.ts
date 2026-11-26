/**
 * Apoio dos testes do resgate: Valkey em container e semeadura direta (como `arp_owner`)
 * de `entradas` e `outbox` com datas controladas.
 */
import { VALKEY_IMAGE } from '@genus/queue';
import { createLogger } from '@genus/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

export interface TestValkey {
  url: string;
  stop(): Promise<void>;
}

export async function startValkey(): Promise<TestValkey> {
  const container: StartedTestContainer = await new GenericContainer(VALKEY_IMAGE)
    .withExposedPorts(6379)
    .withCommand(['valkey-server', '--maxmemory-policy', 'noeviction'])
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  return {
    url: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
    stop: async () => {
      await container.stop();
    },
  };
}

export interface LogLine {
  level: string;
  event?: string;
  [key: string]: unknown;
}

export function captureLogs() {
  const lines: LogLine[] = [];
  const logger = createLogger({
    level: 'debug',
    service: 'jobs-test',
    destination: {
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk) as LogLine);
      },
    },
  });
  return { logger, lines, byEvent: (event: string) => lines.filter((l) => l.event === event) };
}

/** Remove os jobs das filas (os nomes são fixos entre testes). */
export async function resetQueues(valkeyUrl: string): Promise<void> {
  const conn = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
  try {
    for (const name of ['punches', 'post-punch', 'day-recalculation']) {
      const q = new Queue(name, { connection: conn });
      await q.obliterate({ force: true });
      await q.close();
    }
  } finally {
    conn.disconnect();
  }
}

/** Apaga as linhas pendentes de testes anteriores (o dono da tabela pode; o trigger só barra `registros`/`evidencias`). */
export async function resetTables(owner: pg.Pool): Promise<void> {
  await owner.query('DELETE FROM outbox');
  await owner.query('DELETE FROM entradas');
}

/** Insere `count` entradas `pendente` com `recebido_em` fixo. Devolve ids e sequências na ordem. */
export async function insertEntries(
  owner: pg.Pool,
  spec: { count: number; tenantId?: number; establishmentId: number; deviceId: number; receivedAt: string; firstSequence?: number },
): Promise<{ entryId: number; sequence: number }[]> {
  const first = spec.firstSequence ?? 1;
  const res = await owner.query<{ id: string; sequencia_aparelho: string }>(
    `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id,
                           cpf, marcado_em, recebido_em, metodo_identificacao)
     SELECT $1, $2, $3, s, 1, '12345678901', $4::timestamptz, $4::timestamptz, 'facial'
       FROM generate_series($5::bigint, $6::bigint) AS s
      ORDER BY s
     RETURNING id, sequencia_aparelho`,
    [spec.tenantId ?? 1, spec.establishmentId, spec.deviceId, spec.receivedAt, first, first + spec.count - 1],
  );
  return res.rows.map((r) => ({ entryId: Number(r.id), sequence: Number(r.sequencia_aparelho) }));
}

export async function insertOutbox(
  owner: pg.Pool,
  spec: { tenantId?: number; establishmentId: number; nsr: number; createdAt: string; status?: 'pendente' | 'processado' },
): Promise<number[]> {
  const chave = `${spec.establishmentId}-${spec.nsr}`;
  const res = await owner.query<{ id: string }>(
    `INSERT INTO outbox (conta_id, estabelecimento_id, evento, chave, payload, status, criado_em, processado_em)
     SELECT $1, $2, ev, $3, $4::jsonb, $5::text, $6::timestamptz,
            CASE WHEN $5::text = 'processado' THEN $6::timestamptz END
       FROM unnest(ARRAY['generate-receipt-pdf', 'recalculate-day', 'official-qr']) AS ev
     RETURNING id`,
    [
      spec.tenantId ?? 1,
      spec.establishmentId,
      chave,
      JSON.stringify({ establishmentId: spec.establishmentId, nsr: spec.nsr }),
      spec.status ?? 'pendente',
      spec.createdAt,
    ],
  );
  return res.rows.map((r) => Number(r.id));
}

export async function waitFor(check: () => Promise<boolean>, what: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`Prazo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
