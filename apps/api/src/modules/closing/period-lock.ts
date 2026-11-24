/**
 * Período fechado (RF46): o trigger fn_bloqueia_periodo_fechado barra
 * `apuracoes_dia` e `ajustes`. As tabelas filhas (marcações, inconsistências,
 * afastamentos, espelhos) não têm trigger: a api confere antes, com a mesma
 * função do banco (`rh.fn_periodo_fechado`), e responde 409 PERIODO_FECHADO.
 */
import { sql } from 'drizzle-orm';
import type { Executor } from '../../db/executor';
import { HttpError } from '../../plugins/error-handler';
import type { CivilDate } from '../rules-common/rules/civil-time';

export const periodClosed = () => new HttpError(409, 'PERIODO_FECHADO', 'O período está fechado: reabra antes de alterar');

export async function closedDates(ex: Executor, employeeId: number, from: CivilDate, to: CivilDate): Promise<CivilDate[]> {
  const res = await ex.execute<{ data: string }>(sql`
    SELECT to_char(d, 'YYYY-MM-DD') AS data
      FROM generate_series(${from}::date, ${to}::date, interval '1 day') AS d
     WHERE rh.fn_periodo_fechado(${employeeId}::bigint, d::date)`);
  return res.rows.map((r) => r.data);
}

export async function assertPeriodOpen(ex: Executor, employeeId: number, from: CivilDate, to: CivilDate = from): Promise<void> {
  if ((await closedDates(ex, employeeId, from, to)).length > 0) throw periodClosed();
}
