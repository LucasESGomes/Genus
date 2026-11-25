/**
 * Agregados de reconhecimento sobre `arp.entradas`, SÓ LEITURA (papel `arp_reader`), para o painel do
 * super_admin (04 §1.4). Só COUNT, AVG e percentis: nenhuma consulta seleciona `cpf` nem `colaborador_id`,
 * e nenhuma devolve batida individual. SQL parametrizado; o único texto fixo variável é o `date_trunc`,
 * escolhido de uma lista fechada.
 */
import type pg from 'pg';
import type { ArpScope, RecognitionAggregateRow, RecognitionDeviceRow, RecognitionSeriesRow, RecognitionStatsReader } from '../modules/super-admin/deps';

const HISTOGRAM_BUCKETS = 10;
const DEVICE_LIMIT = 500;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** WHERE comum: período [from, to) e, quando informados, conta, estabelecimento e aparelho. */
function scopeWhere(scope: ArpScope): { where: string; params: unknown[] } {
  const params: unknown[] = [scope.from, scope.to];
  const conds = ['marcado_em >= $1', 'marcado_em < $2'];
  const add = (column: string, value: number | null | undefined) => {
    if (value === null || value === undefined) return;
    params.push(value);
    conds.push(`${column} = $${params.length}`);
  };
  add('conta_id', scope.tenantId);
  add('estabelecimento_id', scope.establishmentId);
  add('aparelho_id', scope.deviceId);
  return { where: conds.join(' AND '), params };
}

export class PgRecognitionStatsReader implements RecognitionStatsReader {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  async summary(scope: ArpScope): Promise<RecognitionAggregateRow> {
    const { where, params } = scopeWhere(scope);
    const [agg, hist] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        `SELECT count(*)::int AS punches,
                (count(*) FILTER (WHERE status = 'pendente'))::int AS pendente,
                (count(*) FILTER (WHERE status = 'processado'))::int AS processado,
                (count(*) FILTER (WHERE status = 'falhou'))::int AS falhou,
                (count(*) FILTER (WHERE eh_hora_divergente))::int AS divergent,
                avg(nota_reconhecimento)::float8 AS rec_avg,
                (percentile_cont(0.5) WITHIN GROUP (ORDER BY nota_reconhecimento))::float8 AS rec_p50,
                (percentile_cont(0.05) WITHIN GROUP (ORDER BY nota_reconhecimento))::float8 AS rec_p05,
                avg(nota_vivacidade)::float8 AS liv_avg,
                (percentile_cont(0.5) WITHIN GROUP (ORDER BY nota_vivacidade))::float8 AS liv_p50,
                (percentile_cont(0.05) WITHIN GROUP (ORDER BY nota_vivacidade))::float8 AS liv_p05
           FROM entradas
          WHERE ${where}`,
        params,
      ),
      // width_bucket(x, 0, 1, 10): 1..10, e 11 para x = 1. Prende em 1..10.
      this.pool.query<{ bucket: number; n: number }>(
        `SELECT least(greatest(width_bucket(nota_vivacidade::float8, 0, 1, ${HISTOGRAM_BUCKETS}), 1), ${HISTOGRAM_BUCKETS})::int AS bucket,
                count(*)::int AS n
           FROM entradas
          WHERE ${where} AND nota_vivacidade IS NOT NULL
          GROUP BY 1`,
        params,
      ),
    ]);
    const r = agg.rows[0] ?? {};
    const livenessHistogram = Array<number>(HISTOGRAM_BUCKETS).fill(0);
    for (const row of hist.rows) livenessHistogram[row.bucket - 1] = Number(row.n);
    return {
      punches: Number(r.punches ?? 0),
      pendente: Number(r.pendente ?? 0),
      processado: Number(r.processado ?? 0),
      falhou: Number(r.falhou ?? 0),
      divergentClock: Number(r.divergent ?? 0),
      recognitionAvg: num(r.rec_avg),
      recognitionP50: num(r.rec_p50),
      recognitionP05: num(r.rec_p05),
      livenessAvg: num(r.liv_avg),
      livenessP50: num(r.liv_p50),
      livenessP05: num(r.liv_p05),
      livenessHistogram,
    };
  }

  async series(scope: ArpScope, bucket: 'hour' | 'day'): Promise<RecognitionSeriesRow[]> {
    const { where, params } = scopeWhere(scope);
    const unit = bucket === 'day' ? 'day' : 'hour';
    params.push(unit);
    const { rows } = await this.pool.query<{ bucket_start: Date; punches: number; failed: number; rec_avg: number | null; liv_avg: number | null }>(
      `SELECT (date_trunc($${params.length}::text, marcado_em AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS bucket_start,
              count(*)::int AS punches,
              (count(*) FILTER (WHERE status = 'falhou'))::int AS failed,
              avg(nota_reconhecimento)::float8 AS rec_avg,
              avg(nota_vivacidade)::float8 AS liv_avg
         FROM entradas
        WHERE ${where}
        GROUP BY 1
        ORDER BY 1`,
      params,
    );
    return rows.map((r) => ({ bucketStart: r.bucket_start, punches: Number(r.punches), failed: Number(r.failed), avgRecognitionScore: num(r.rec_avg), avgLivenessScore: num(r.liv_avg) }));
  }

  async devices(scope: ArpScope): Promise<RecognitionDeviceRow[]> {
    const { where, params } = scopeWhere(scope);
    const { rows } = await this.pool.query<{
      conta_id: string;
      estabelecimento_id: string;
      aparelho_id: string;
      punches: number;
      failed: number;
      divergent: number;
      rec_avg: number | null;
      liv_avg: number | null;
      last_at: Date | null;
    }>(
      `SELECT conta_id, estabelecimento_id, aparelho_id,
              count(*)::int AS punches,
              (count(*) FILTER (WHERE status = 'falhou'))::int AS failed,
              (count(*) FILTER (WHERE eh_hora_divergente))::int AS divergent,
              avg(nota_reconhecimento)::float8 AS rec_avg,
              avg(nota_vivacidade)::float8 AS liv_avg,
              max(marcado_em) AS last_at
         FROM entradas
        WHERE ${where}
        GROUP BY conta_id, estabelecimento_id, aparelho_id
        ORDER BY punches DESC, aparelho_id
        LIMIT ${DEVICE_LIMIT}`,
      params,
    );
    return rows.map((r) => ({
      tenantId: Number(r.conta_id),
      establishmentId: Number(r.estabelecimento_id),
      deviceId: Number(r.aparelho_id),
      punches: Number(r.punches),
      failed: Number(r.failed),
      divergentClock: Number(r.divergent),
      avgRecognitionScore: num(r.rec_avg),
      avgLivenessScore: num(r.liv_avg),
      lastPunchAt: r.last_at,
    }));
  }
}
