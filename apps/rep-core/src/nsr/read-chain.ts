import type { Pool } from 'pg';
import type { RecordType } from './hash.js';
import { toSafeInt } from './safe-int.js';
import type { ChainRow } from './verify-chain.js';

interface ChainDbRow {
  nsr: string;
  tipo: RecordType;
  cpf: string | null;
  marcado_em_txt: string;
  gravado_em_txt: string;
  tipo_coletor: string;
  eh_offline: boolean;
  hash: Buffer;
  hash_anterior: Buffer;
  versao_formato_hash: number;
}

/**
 * Lê a cadeia de um estabelecimento (use o pool do `arp_reader`). Timestamps saem como
 * TEXTO com 6 casas: o verificador precisa enxergar microssegundo real persistido,
 * que uma conversão para Date esconderia (SPEC §1, "Precisão de tempo").
 */
export async function readChain(
  pool: Pool,
  input: { tenantId: number; establishmentId: number },
): Promise<ChainRow[]> {
  const res = await pool.query<ChainDbRow>(
    `SELECT nsr, tipo, cpf,
            to_char(marcado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS marcado_em_txt,
            to_char(gravado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS gravado_em_txt,
            tipo_coletor, eh_offline, hash, hash_anterior, versao_formato_hash
       FROM registros
      WHERE conta_id = $1 AND estabelecimento_id = $2
      ORDER BY nsr`,
    [input.tenantId, input.establishmentId],
  );
  return res.rows.map((r) => ({
    nsr: toSafeInt(r.nsr, 'registros.nsr'),
    tipo: r.tipo,
    cpf: r.cpf,
    marcadoEm: r.marcado_em_txt,
    gravadoEm: r.gravado_em_txt,
    tipoColetor: r.tipo_coletor,
    ehOffline: r.eh_offline,
    hash: r.hash,
    hashAnterior: r.hash_anterior,
    versaoFormatoHash: Number(r.versao_formato_hash),
  }));
}
