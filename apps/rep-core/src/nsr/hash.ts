import { createHash } from 'node:crypto';

/**
 * Hash encadeado do registro fiscal (docs/SPEC-nsr-fila.md §4). Função PURA:
 * sem I/O, sem relógio. Quem chama entrega os timestamps já em texto.
 *
 * [A CONFIRMAR] leiaute do registro tipo 7 do AFD (Portaria MTP 671/2021), a fórmula
 * exata do hash e o fuso. Trocar a fórmula = nova HASH_FORMAT_VERSION; o passado
 * (registros já gravados) nunca é reinterpretado.
 */
export const HASH_FORMAT_VERSION = 1;

/** Hash anterior do primeiro registro de um estabelecimento: 32 bytes zero. [A CONFIRMAR] */
export const GENESIS_HASH: Buffer = Buffer.alloc(32);

export type RecordType = '2' | '4' | '5' | '6' | '7';

export interface HashableRecord {
  nsr: number;
  tipo: RecordType;
  /** ISO 8601 UTC com exatamente 3 casas: 2026-11-20T12:00:00.000Z */
  marcadoEm: string;
  /** 11 dígitos quando tipo '7'; null nos demais */
  cpf: string | null;
  gravadoEm: string;
  /** '01'..'05' */
  tipoColetor: string;
  ehOffline: boolean;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TIPOS: readonly string[] = ['2', '4', '5', '6', '7'];
const COLETORES: readonly string[] = ['01', '02', '03', '04', '05'];

/** Converte Date no formato do hash (ISO UTC, milissegundos). */
export function toHashTimestamp(date: Date): string {
  return date.toISOString();
}

/** true se o texto está EXATAMENTE no formato do hash e é uma data real. */
export function isHashTimestamp(value: string): boolean {
  if (!TIMESTAMP_RE.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString() === value;
}

function assertTimestamp(field: string, value: string): void {
  if (!isHashTimestamp(value)) {
    throw new Error(`${field} fora do formato ISO UTC com 3 casas: ${JSON.stringify(value)}`);
  }
}

export function canonicalString(record: HashableRecord, previousHash: Buffer): string {
  if (!Buffer.isBuffer(previousHash) || previousHash.length !== 32) {
    throw new Error('previousHash deve ter 32 bytes');
  }
  if (!Number.isSafeInteger(record.nsr) || record.nsr <= 0) {
    throw new Error('nsr deve ser inteiro positivo seguro');
  }
  if (!TIPOS.includes(record.tipo)) throw new Error(`tipo inválido: ${String(record.tipo)}`);
  assertTimestamp('marcadoEm', record.marcadoEm);
  assertTimestamp('gravadoEm', record.gravadoEm);
  if (!COLETORES.includes(record.tipoColetor)) {
    throw new Error(`tipoColetor inválido: ${String(record.tipoColetor)}`);
  }
  if (record.cpf !== null && !/^\d{11}$/.test(record.cpf)) {
    throw new Error('cpf deve ter 11 dígitos');
  }
  if (record.tipo === '7' && record.cpf === null) {
    throw new Error("cpf é obrigatório no tipo '7'");
  }
  return [
    String(record.nsr),
    record.tipo,
    record.marcadoEm,
    record.cpf ?? '',
    record.gravadoEm,
    record.tipoColetor,
    record.ehOffline ? 'true' : 'false',
    previousHash.toString('hex'),
  ].join('|');
}

/** SHA-256 (32 bytes) da string canônica em UTF-8. */
export function computeRecordHash(record: HashableRecord, previousHash: Buffer): Buffer {
  return createHash('sha256').update(canonicalString(record, previousHash), 'utf8').digest();
}
