/**
 * Acesso a `arp.entradas`. SQL puro. SÓ INSERT e SELECT (o papel arp_collector
 * não tem mais que isso) e TODA query filtra `conta_id` (tenantId é sempre o
 * primeiro argumento de dado).
 */
import type { Pool } from 'pg';

/** O que a api devolve ao aparelho como recibo. */
export interface EntryReceipt {
  publicId: string;
  markedAt: Date;
  isClockDivergent: boolean;
}

export interface NewEntry {
  publicId: string;
  establishmentId: number;
  deviceId: number;
  deviceSequence: number;
  employeeId: number;
  cpf: string;
  markedAt: Date;
  receivedAt: Date;
  isClockDivergent: boolean;
  recognitionScore: number | null;
  livenessScore: number | null;
}

interface ReceiptRow {
  id_publico: string;
  marcado_em: Date;
  eh_hora_divergente: boolean;
}

function toReceipt(row: ReceiptRow): EntryReceipt {
  return { publicId: row.id_publico, markedAt: row.marcado_em, isClockDivergent: row.eh_hora_divergente };
}

export class PunchRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  /** Idempotência: já existe entrada deste aparelho com esta sequência? */
  async findByDeviceSequence(
    tenantId: number,
    deviceId: number,
    deviceSequence: number,
  ): Promise<EntryReceipt | null> {
    const { rows } = await this.pool.query<ReceiptRow>(
      `SELECT id_publico, marcado_em, eh_hora_divergente
         FROM entradas
        WHERE conta_id = $1 AND aparelho_id = $2 AND sequencia_aparelho = $3`,
      [tenantId, deviceId, deviceSequence],
    );
    return rows[0] ? toReceipt(rows[0]) : null;
  }

  async findByPublicId(tenantId: number, publicId: string): Promise<EntryReceipt | null> {
    const { rows } = await this.pool.query<ReceiptRow>(
      `SELECT id_publico, marcado_em, eh_hora_divergente
         FROM entradas
        WHERE conta_id = $1 AND id_publico = $2`,
      [tenantId, publicId],
    );
    return rows[0] ? toReceipt(rows[0]) : null;
  }

  /** Mesma pessoa com entrada em (from, to]? Só sinaliza duplicidade; nunca bloqueia. */
  async existsByCpfBetween(tenantId: number, cpf: string, from: Date, to: Date): Promise<boolean> {
    const { rows } = await this.pool.query<{ existe: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM entradas
          WHERE conta_id = $1 AND cpf = $2 AND marcado_em > $3 AND marcado_em <= $4
       ) AS existe`,
      [tenantId, cpf, from, to],
    );
    return rows[0]?.existe === true;
  }

  /**
   * Grava a entrada `pendente`. `null` quando outra requisição já gravou a mesma
   * (aparelho, sequência) (corrida): quem chama refaz a consulta de idempotência.
   */
  async insertIfAbsent(tenantId: number, entry: NewEntry): Promise<EntryReceipt | null> {
    const { rows } = await this.pool.query<ReceiptRow>(
      `INSERT INTO entradas (
           id_publico, conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho,
           colaborador_id, cpf, marcado_em, recebido_em, eh_hora_divergente,
           metodo_identificacao, nota_reconhecimento, nota_vivacidade
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'facial', $11, $12)
         ON CONFLICT (aparelho_id, sequencia_aparelho) DO NOTHING
         RETURNING id_publico, marcado_em, eh_hora_divergente`,
      [
        entry.publicId,
        tenantId,
        entry.establishmentId,
        entry.deviceId,
        entry.deviceSequence,
        entry.employeeId,
        entry.cpf,
        entry.markedAt,
        entry.receivedAt,
        entry.isClockDivergent,
        entry.recognitionScore,
        entry.livenessScore,
      ],
    );
    return rows[0] ? toReceipt(rows[0]) : null;
  }
}
