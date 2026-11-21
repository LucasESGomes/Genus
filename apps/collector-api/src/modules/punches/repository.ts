/**
 * Acesso a `arp.entradas`. SQL puro. SÓ INSERT e SELECT (o papel arp_collector
 * não tem mais que isso) e TODA query filtra `conta_id` (tenantId é sempre o
 * primeiro argumento de dado).
 */
import type { Pool } from 'pg';

/** O que a api devolve ao aparelho como recibo. */
export interface EntryReceipt {
  /** `entradas.id` (BIGINT convertido). Só para enfileirar; nunca sai na resposta HTTP. */
  id: number;
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
  id: string | number;
  id_publico: string;
  marcado_em: Date;
  eh_hora_divergente: boolean;
}

function toReceipt(row: ReceiptRow): EntryReceipt {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id)) throw new Error('entradas.id fora do intervalo seguro');
  return { id, publicId: row.id_publico, markedAt: row.marcado_em, isClockDivergent: row.eh_hora_divergente };
}

/** Status de uma entrada, com o NSR se o rep-core já a processou. Sem CPF. */
export interface EntryStatus {
  publicId: string;
  establishmentId: number;
  deviceId: number;
  deviceSequence: number;
  employeeId: number;
  status: 'pendente' | 'processado' | 'falhou';
  attempts: number;
  nsr: number | null;
  markedAt: Date;
  receivedAt: Date;
  processedAt: Date | null;
  isClockDivergent: boolean;
}

interface StatusRow {
  id_publico: string;
  estabelecimento_id: string | number;
  aparelho_id: string | number;
  sequencia_aparelho: string | number;
  colaborador_id: string | number;
  status: EntryStatus['status'];
  tentativas: number;
  nsr: string | number | null;
  marcado_em: Date;
  recebido_em: Date;
  processado_em: Date | null;
  eh_hora_divergente: boolean;
}

function safeInt(value: string | number, column: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`${column} fora do intervalo seguro`);
  return n;
}

function toStatus(row: StatusRow): EntryStatus {
  return {
    publicId: row.id_publico,
    establishmentId: safeInt(row.estabelecimento_id, 'estabelecimento_id'),
    deviceId: safeInt(row.aparelho_id, 'aparelho_id'),
    deviceSequence: safeInt(row.sequencia_aparelho, 'sequencia_aparelho'),
    employeeId: safeInt(row.colaborador_id, 'colaborador_id'),
    status: row.status,
    attempts: row.tentativas,
    nsr: row.nsr === null ? null : safeInt(row.nsr, 'nsr'),
    markedAt: row.marcado_em,
    receivedAt: row.recebido_em,
    processedAt: row.processado_em,
    isClockDivergent: row.eh_hora_divergente,
  };
}

/** O NSR vem de `evidencias` (uma por entrada), filtrada pela mesma conta. */
const STATUS_SELECT = `
  SELECT e.id_publico, e.estabelecimento_id, e.aparelho_id, e.sequencia_aparelho, e.colaborador_id,
         e.status, e.tentativas, v.nsr, e.marcado_em, e.recebido_em, e.processado_em, e.eh_hora_divergente
    FROM entradas e
    LEFT JOIN evidencias v ON v.entrada_id = e.id AND v.conta_id = e.conta_id`;

export class PunchRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  /** Status pela chave do job (`<aparelhoId>-<sequencia>`). */
  async findStatusByDeviceSequence(
    tenantId: number,
    deviceId: number,
    deviceSequence: number,
  ): Promise<EntryStatus | null> {
    const { rows } = await this.pool.query<StatusRow>(
      `${STATUS_SELECT}
        WHERE e.conta_id = $1 AND e.aparelho_id = $2 AND e.sequencia_aparelho = $3`,
      [tenantId, deviceId, deviceSequence],
    );
    return rows[0] ? toStatus(rows[0]) : null;
  }

  /** Batidas de um colaborador, da mais recente para a mais antiga. */
  async listStatusByEmployee(
    tenantId: number,
    employeeId: number,
    page: { limit: number; offset: number },
  ): Promise<{ items: EntryStatus[]; total: number }> {
    const [list, count] = await Promise.all([
      this.pool.query<StatusRow>(
        `${STATUS_SELECT}
          WHERE e.conta_id = $1 AND e.colaborador_id = $2
          ORDER BY e.marcado_em DESC, e.id DESC
          LIMIT $3 OFFSET $4`,
        [tenantId, employeeId, page.limit, page.offset],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*) AS total FROM entradas WHERE conta_id = $1 AND colaborador_id = $2`,
        [tenantId, employeeId],
      ),
    ]);
    return { items: list.rows.map(toStatus), total: Number(count.rows[0]?.total ?? 0) };
  }

  /** Idempotência: já existe entrada deste aparelho com esta sequência? */
  async findByDeviceSequence(
    tenantId: number,
    deviceId: number,
    deviceSequence: number,
  ): Promise<EntryReceipt | null> {
    const { rows } = await this.pool.query<ReceiptRow>(
      `SELECT id, id_publico, marcado_em, eh_hora_divergente
         FROM entradas
        WHERE conta_id = $1 AND aparelho_id = $2 AND sequencia_aparelho = $3`,
      [tenantId, deviceId, deviceSequence],
    );
    return rows[0] ? toReceipt(rows[0]) : null;
  }

  async findByPublicId(tenantId: number, publicId: string): Promise<EntryReceipt | null> {
    const { rows } = await this.pool.query<ReceiptRow>(
      `SELECT id, id_publico, marcado_em, eh_hora_divergente
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
         RETURNING id, id_publico, marcado_em, eh_hora_divergente`,
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
