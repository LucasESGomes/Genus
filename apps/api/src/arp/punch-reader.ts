/**
 * Leitura das batidas no banco `arp`, SÓ LEITURA (papel `arp_reader`). As
 * marcações originais nunca são copiadas nem alteradas pelo RH (RN01,
 * Portaria 671): a apuração só guarda a referência (NSR) em `apuracoes_marcacoes`.
 *
 * Fonte: `registros` tipo '7' (marcação), já com NSR e hash, gravados pelo rep-core.
 * A batida que ainda está em `entradas` (sem NSR) entra na apuração quando o
 * rep-core a processar; recalcular o dia depois a inclui.
 */
import type pg from 'pg';

export interface ArpPunch {
  establishmentId: number;
  nsr: number;
  markedAt: Date;
  /** Coletada sem internet (o NSR foi atribuído na chegada). */
  offline: boolean;
}

export interface ArpPunchQuery {
  tenantId: number;
  cpf: string;
  /** Janela [from, to) em instantes. */
  from: Date;
  to: Date;
}

export interface ArpPunchReader {
  listPunches(q: ArpPunchQuery): Promise<ArpPunch[]>;
  /** Quais destes aparelhos já têm alguma batida no arp (entradas, inclusive as ainda pendentes). */
  devicesWithPunches(tenantId: number, deviceIds: readonly number[]): Promise<Set<number>>;
}

export class PgArpPunchReader implements ArpPunchReader {
  constructor(private readonly pool: Pick<pg.Pool, 'query'>) {}

  async listPunches(q: ArpPunchQuery): Promise<ArpPunch[]> {
    // Índice (conta_id, cpf, marcado_em DESC) WHERE cpf IS NOT NULL. [A CONFIRMAR] batidas do
    // mesmo CPF em outro estabelecimento da conta entram na apuração (o NSR é por estabelecimento).
    const { rows } = await this.pool.query<{ estabelecimento_id: string; nsr: string; marcado_em: Date; eh_offline: boolean }>(
      `SELECT estabelecimento_id, nsr, marcado_em, eh_offline
         FROM registros
        WHERE conta_id = $1 AND cpf = $2 AND tipo = '7' AND marcado_em >= $3 AND marcado_em < $4
        ORDER BY marcado_em, estabelecimento_id, nsr`,
      [q.tenantId, q.cpf, q.from, q.to],
    );
    return rows.map((r) => ({
      establishmentId: Number(r.estabelecimento_id),
      nsr: Number(r.nsr),
      markedAt: r.marcado_em,
      offline: r.eh_offline,
    }));
  }

  async devicesWithPunches(tenantId: number, deviceIds: readonly number[]): Promise<Set<number>> {
    if (deviceIds.length === 0) return new Set();
    // uq_entradas_aparelho_id_sequencia_aparelho cobre a busca por aparelho_id
    const { rows } = await this.pool.query<{ aparelho_id: string }>(
      'SELECT DISTINCT aparelho_id FROM entradas WHERE conta_id = $1 AND aparelho_id = ANY($2::bigint[])',
      [tenantId, [...deviceIds]],
    );
    return new Set(rows.map((r) => Number(r.aparelho_id)));
  }
}
