/**
 * Consultas de asserção contra o banco `arp` (papel dono, só leitura aqui) e a cadeia.
 * Nada aqui escreve em `registros` ou `evidencias`.
 */
import { checkProcessedInvariant } from '../../../apps/rep-core/src/nsr/check-invariant';
import { readChain } from '../../../apps/rep-core/src/nsr/read-chain';
import { verifyChain } from '../../../apps/rep-core/src/nsr/verify-chain';
import type pg from 'pg';
import { scalar, type Infra } from './infra';

export async function nsrList(owner: pg.Pool, establishmentId: number): Promise<number[]> {
  const res = await owner.query<{ nsr: string }>(
    'SELECT nsr FROM registros WHERE estabelecimento_id = $1 ORDER BY nsr',
    [establishmentId],
  );
  return res.rows.map((r) => Number(r.nsr));
}

export function range(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

export async function entryStatusCounts(owner: pg.Pool, establishmentId: number): Promise<Record<string, number>> {
  const res = await owner.query<{ status: string; n: string }>(
    'SELECT status, count(*) AS n FROM entradas WHERE estabelecimento_id = $1 GROUP BY status',
    [establishmentId],
  );
  return Object.fromEntries(res.rows.map((r) => [r.status, Number(r.n)]));
}

export async function outboxCounts(owner: pg.Pool, establishmentId: number): Promise<Record<string, number>> {
  const res = await owner.query<{ status: string; n: string }>(
    'SELECT status, count(*) AS n FROM outbox WHERE estabelecimento_id = $1 GROUP BY status',
    [establishmentId],
  );
  return Object.fromEntries(res.rows.map((r) => [r.status, Number(r.n)]));
}

export const countRegistros = (owner: pg.Pool, est: number) =>
  scalar(owner, 'SELECT count(*) AS n FROM registros WHERE estabelecimento_id = $1', [est]);
export const countEvidencias = (owner: pg.Pool, est: number) =>
  scalar(owner, 'SELECT count(*) AS n FROM evidencias WHERE estabelecimento_id = $1', [est]);
export const countOutbox = (owner: pg.Pool, est: number) =>
  scalar(owner, 'SELECT count(*) AS n FROM outbox WHERE estabelecimento_id = $1', [est]);
export const countEntries = (owner: pg.Pool, est: number) =>
  scalar(owner, 'SELECT count(*) AS n FROM entradas WHERE estabelecimento_id = $1', [est]);

export async function entryIds(owner: pg.Pool, establishmentId: number): Promise<number[]> {
  const res = await owner.query<{ id: string }>(
    'SELECT id FROM entradas WHERE estabelecimento_id = $1 ORDER BY id',
    [establishmentId],
  );
  return res.rows.map((r) => Number(r.id));
}

/** Cadeia de hash e invariante "processado => registro + evidência + 3 eventos" (SPEC §2 item 5). */
export async function chainReport(infra: Infra, tenantId: number, establishmentId: number) {
  const rows = await readChain(infra.reader, { tenantId, establishmentId });
  const report = verifyChain(rows);
  const invariant = await checkProcessedInvariant(infra.reader, { tenantId, establishmentId });
  return { report, invariant };
}
