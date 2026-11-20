import { createHash } from 'node:crypto';
import pg from 'pg';
import type { Clock } from '@genus/shared';

export interface SeedEntries {
  tenantId: number;
  establishmentId: number;
  deviceId: number;
  count: number;
  /** Primeira sequência do aparelho (padrão 1). */
  firstSequence?: number;
  /** `marcado_em` da i-ésima entrada (texto aceito pelo Postgres). Padrão: 1 s de intervalo. */
  markedAt?: (i: number) => string;
}

/** Insere entradas `pendente` como `arp_collector`, em lote. Devolve os ids na ordem. */
export async function seedEntries(collectorUrl: string, spec: SeedEntries): Promise<number[]> {
  const first = spec.firstSequence ?? 1;
  const markedAt =
    spec.markedAt ??
    ((i: number) => new Date(Date.UTC(2026, 10, 20, 12, 0, 0) + i * 1000 + (i % 1000)).toISOString());
  const seqs: number[] = [];
  const marks: string[] = [];
  const cpfs: string[] = [];
  for (let i = 0; i < spec.count; i++) {
    seqs.push(first + i);
    marks.push(markedAt(i));
    cpfs.push(String(10000000000 + (i % 90000000000)));
  }
  const client = new pg.Client({ connectionString: collectorUrl });
  await client.connect();
  try {
    const res = await client.query<{ id: string }>(
      `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id,
                             cpf, marcado_em, recebido_em, metodo_identificacao, nota_reconhecimento, nota_vivacidade)
       SELECT $1, $2, $3, s.seq, 1, s.cpf, s.marcado::timestamptz, s.marcado::timestamptz, 'facial', 0.9, 0.95
         FROM unnest($4::bigint[], $5::text[], $6::text[]) AS s(seq, marcado, cpf)
        ORDER BY s.seq
       RETURNING id`,
      [spec.tenantId, spec.establishmentId, spec.deviceId, seqs, marks, cpfs],
    );
    return res.rows.map((r) => Number(r.id));
  } finally {
    await client.end();
  }
}

/** Relógio que avança 1 ms a cada leitura (contador em memória, sem relógio real). */
export class TickingClock implements Clock {
  private ticks = 0;
  constructor(private readonly base: number = Date.UTC(2026, 10, 20, 13, 0, 0)) {}
  now(): Date {
    return new Date(this.base + this.ticks++);
  }
}

/** Embaralha (Fisher-Yates) uma cópia. */
export function shuffle<T>(items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Roda `tasks` com `concurrency` trabalhadores sobre uma fila compartilhada, via Promise.all. */
export async function runQueue<T, R>(
  tasks: readonly T[],
  concurrency: number,
  fn: (t: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await fn(tasks[i]!);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export interface RawRegistro {
  nsr: number;
  cpf: string;
  marcadoEm: string;
  gravadoEm: string;
  hash: Buffer;
  hashAnterior: Buffer;
}

/** Lê `registros` com timestamps em texto (ms), para o recálculo independente do hash. */
export async function readRawRegistros(
  client: pg.Client | pg.Pool,
  establishmentId: number,
): Promise<RawRegistro[]> {
  const r = await client.query<{
    nsr: string;
    cpf: string;
    m: string;
    g: string;
    hash: Buffer;
    hash_anterior: Buffer;
  }>(
    `SELECT nsr, cpf,
            to_char(marcado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS m,
            to_char(gravado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS g,
            hash, hash_anterior
       FROM registros WHERE estabelecimento_id = $1 ORDER BY nsr`,
    [establishmentId],
  );
  return r.rows.map((x) => ({
    nsr: Number(x.nsr),
    cpf: x.cpf,
    marcadoEm: x.m,
    gravadoEm: x.g,
    hash: x.hash,
    hashAnterior: x.hash_anterior,
  }));
}

/**
 * Recalcula a cadeia SEM usar computeRecordHash: reimplementa a fórmula da SPEC §4
 * (nsr|tipo|marcado_em|cpf|gravado_em|tipo_coletor|eh_offline|hash_anterior), com genesis de 32 bytes zero.
 */
export function independentChain(rows: readonly RawRegistro[]): Buffer[] {
  const out: Buffer[] = [];
  let prev = Buffer.alloc(32);
  for (const r of rows) {
    const s = `${r.nsr}|7|${r.marcadoEm}|${r.cpf}|${r.gravadoEm}|01|false|${prev.toString('hex')}`;
    const h = createHash('sha256').update(s, 'utf8').digest();
    out.push(h);
    prev = h;
  }
  return out;
}

export async function scalar(client: pg.Client | pg.Pool, sql: string, params: unknown[] = []): Promise<number> {
  const r = await client.query<{ n: string }>(sql, params);
  return Number(r.rows[0]!.n);
}
