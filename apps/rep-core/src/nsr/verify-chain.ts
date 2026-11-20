import {
  computeRecordHash,
  GENESIS_HASH,
  HASH_FORMAT_VERSION,
  type RecordType,
} from './hash.js';

/** Linha de `registros`, com timestamps lidos como TEXTO pelo banco (microssegundos). */
export interface ChainRow {
  nsr: number;
  tipo: RecordType;
  marcadoEm: string;
  cpf: string | null;
  gravadoEm: string;
  tipoColetor: string;
  ehOffline: boolean;
  hash: Buffer;
  hashAnterior: Buffer;
  versaoFormatoHash: number;
}

export interface ChainReport {
  /** false se houver qualquer corrupção. Anomalias (warnings) não afetam. */
  ok: boolean;
  errors: string[];
  warnings: string[];
  rowsChecked: number;
  lastNsr: number;
  lastHash: Buffer;
}

const DB_TIMESTAMP_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)Z$/;

/**
 * Converte o texto do banco para o formato de 3 casas. Só trunca depois de conferir
 * que os dígitos extras são zero: microssegundo real persistido é corrupção
 * (docs/SPEC-nsr-fila.md §1, "Precisão de tempo"). Devolve null se inválido.
 */
function normalizeTimestamp(value: string): string | null {
  const m = DB_TIMESTAMP_RE.exec(value);
  if (!m) return null;
  const [, base, frac] = m;
  if (base === undefined || frac === undefined || frac.length < 3) return null;
  if (!/^0*$/.test(frac.slice(3))) return null;
  const normalized = `${base}.${frac.slice(0, 3)}Z`;
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
}

export function verifyChain(
  rows: readonly ChainRow[],
  genesis: Buffer = GENESIS_HASH,
): ChainReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let expectedNsr = 1;
  let previousHash = genesis;
  let previousGravadoEm: string | null = null;
  let lastNsr = 0;

  for (const row of rows) {
    if (row.nsr !== expectedNsr) {
      errors.push(`NSR não contíguo: esperado ${expectedNsr}, encontrado ${row.nsr}`);
    }
    if (!row.hashAnterior.equals(previousHash)) {
      errors.push(`NSR ${row.nsr}: hash_anterior não confere com o hash da linha anterior`);
    }

    const marcadoEm = normalizeTimestamp(row.marcadoEm);
    const gravadoEm = normalizeTimestamp(row.gravadoEm);
    if (marcadoEm === null) {
      errors.push(`NSR ${row.nsr}: marcado_em com precisão ou formato inválido (${row.marcadoEm})`);
    }
    if (gravadoEm === null) {
      errors.push(`NSR ${row.nsr}: gravado_em com precisão ou formato inválido (${row.gravadoEm})`);
    }

    if (row.versaoFormatoHash !== HASH_FORMAT_VERSION) {
      // Versão desconhecida: não recalcular com a fórmula errada.
      errors.push(
        `NSR ${row.nsr}: versao_formato_hash ${row.versaoFormatoHash} desconhecida (esperada ${HASH_FORMAT_VERSION})`,
      );
    } else if (marcadoEm !== null && gravadoEm !== null) {
      try {
        // O hash é recalculado sobre o hash_anterior GRAVADO; a quebra de elo já foi registrada acima.
        const recomputed = computeRecordHash(
          {
            nsr: row.nsr,
            tipo: row.tipo,
            marcadoEm,
            cpf: row.cpf,
            gravadoEm,
            tipoColetor: row.tipoColetor,
            ehOffline: row.ehOffline,
          },
          row.hashAnterior,
        );
        if (!recomputed.equals(row.hash)) {
          errors.push(`NSR ${row.nsr}: hash gravado difere do recalculado`);
        }
      } catch (e) {
        // Dado ruim (tipo, cpf, nsr, tamanho do hash) é corrupção, não exceção.
        errors.push(`NSR ${row.nsr}: registro inválido (${e instanceof Error ? e.message : 'erro'})`);
      }
    }

    if (gravadoEm !== null) {
      if (previousGravadoEm !== null && gravadoEm < previousGravadoEm) {
        warnings.push(
          `NSR ${row.nsr}: gravado_em (${gravadoEm}) anterior ao do NSR anterior (${previousGravadoEm})`,
        );
      }
      previousGravadoEm = gravadoEm;
    }

    previousHash = row.hash;
    lastNsr = row.nsr;
    expectedNsr = row.nsr + 1;
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    rowsChecked: rows.length,
    lastNsr,
    lastHash: previousHash,
  };
}
