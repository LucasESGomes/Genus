/**
 * Leituras operacionais do banco `arp` para o painel do super_admin (stats e saúde), SÓ LEITURA
 * (papel `arp_reader`). Só agregados: nunca seleciona `cpf` nem `colaborador_id` (04 §1.4).
 */
import type { Pool } from 'pg';
import type { ArpOpsReader, ArpScope } from '../modules/super-admin/deps';

type Queryable = Pick<Pool, 'query'>;

interface PendingRow {
  total: string;
  oldest_age_seconds: string | null;
}

export class PgArpOpsReader implements ArpOpsReader {
  constructor(private readonly pool: Queryable) {}

  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async punchesPerDay(scope: Pick<ArpScope, 'tenantId' | 'from' | 'to'>): Promise<{ day: string; tenantId: number; punches: number; processed: number }[]> {
    // Dia em UTC (o fuso do estabelecimento não está no arp). `marcado_em` não tem índice próprio:
    // a janela é de no máximo 30 dias e o filtro por conta usa idx_entradas_conta_id_cpf_marcado_em.
    const { rows } = await this.pool.query<{ day: string; conta_id: string; punches: string; processed: string }>(
      `SELECT to_char((marcado_em AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day,
              conta_id,
              COUNT(*) AS punches,
              COUNT(*) FILTER (WHERE status = 'processado') AS processed
         FROM entradas
        WHERE marcado_em >= $1 AND marcado_em < $2
          AND ($3::bigint IS NULL OR conta_id = $3)
        GROUP BY 1, 2
        ORDER BY 1, 2`,
      [scope.from, scope.to, scope.tenantId],
    );
    return rows.map((r) => ({ day: r.day, tenantId: Number(r.conta_id), punches: Number(r.punches), processed: Number(r.processed) }));
  }

  pendingEntries(): Promise<{ count: number; oldestAgeSeconds: number | null }> {
    return this.pending('entradas');
  }

  pendingOutbox(): Promise<{ count: number; oldestAgeSeconds: number | null }> {
    return this.pending('outbox');
  }

  /** `table` vem só das duas chamadas acima (constante), nunca de entrada externa. */
  private async pending(table: 'entradas' | 'outbox'): Promise<{ count: number; oldestAgeSeconds: number | null }> {
    const { rows } = await this.pool.query<PendingRow>(
      `SELECT COUNT(*) AS total, EXTRACT(EPOCH FROM (now() - MIN(criado_em))) AS oldest_age_seconds
         FROM ${table}
        WHERE status = 'pendente'`,
    );
    const row = rows[0];
    return {
      count: Number(row?.total ?? 0),
      oldestAgeSeconds: row?.oldest_age_seconds == null ? null : Math.max(0, Math.round(Number(row.oldest_age_seconds))),
    };
  }
}
