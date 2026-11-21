/**
 * Lê os dois bancos e roda `compareArpWithRh`. Só SELECT: no arp com o papel
 * somente leitura (arp_reader), no RH com o papel da api (rh_api).
 */
import pg from 'pg';
import { compareArpWithRh, type ArpPunchRef, type ArpRecordRef, type Finding, type RhSnapshot } from './consistency';

async function readArp(client: pg.ClientBase): Promise<{ punches: ArpPunchRef[]; records: ArpRecordRef[] }> {
  // bigint chega como string no pg; os IDs do Genus cabem em Number (Number.MAX_SAFE_INTEGER).
  const punches = await client.query<{ c: string; e: string; a: string; p: string; cpf: string }>(
    `SELECT DISTINCT conta_id AS c, estabelecimento_id AS e, aparelho_id AS a, colaborador_id AS p, cpf FROM entradas`,
  );
  const records = await client.query<{ c: string; e: string; cpf: string | null }>(
    `SELECT DISTINCT conta_id AS c, estabelecimento_id AS e, cpf FROM registros`,
  );
  return {
    punches: punches.rows.map((r) => ({
      tenantId: Number(r.c),
      establishmentId: Number(r.e),
      deviceId: Number(r.a),
      employeeId: Number(r.p),
      cpf: r.cpf,
    })),
    records: records.rows.map((r) => ({ tenantId: Number(r.c), establishmentId: Number(r.e), cpf: r.cpf })),
  };
}

async function readRh(client: pg.ClientBase, tenantIds: number[]): Promise<RhSnapshot> {
  // Toda consulta filtra por conta: só as contas que aparecem no arp.
  // Em sequência: um pg.Client não executa duas consultas ao mesmo tempo.
  const establishments = await client.query<{ c: string; id: string }>(
    'SELECT conta_id AS c, id FROM rh.estabelecimento WHERE conta_id = ANY($1)',
    [tenantIds],
  );
  const devices = await client.query<{ c: string; id: string; e: string }>(
    'SELECT conta_id AS c, id, estabelecimento_id AS e FROM rh.aparelho WHERE conta_id = ANY($1)',
    [tenantIds],
  );
  const employees = await client.query<{ c: string; id: string; cpf: string }>(
    'SELECT conta_id AS c, id, cpf FROM rh.colaborador WHERE conta_id = ANY($1)',
    [tenantIds],
  );
  return {
    establishments: establishments.rows.map((r) => ({ tenantId: Number(r.c), id: Number(r.id) })),
    devices: devices.rows.map((r) => ({ tenantId: Number(r.c), id: Number(r.id), establishmentId: Number(r.e) })),
    employees: employees.rows.map((r) => ({ tenantId: Number(r.c), id: Number(r.id), cpf: r.cpf })),
  };
}

export async function checkArp(arpUrl: string, rhUrl: string): Promise<Finding[]> {
  const arp = new pg.Client({ connectionString: arpUrl });
  const rh = new pg.Client({ connectionString: rhUrl });
  await arp.connect();
  try {
    await rh.connect();
    try {
      const { punches, records } = await readArp(arp);
      const tenantIds = [...new Set([...punches, ...records].map((r) => r.tenantId))];
      const snapshot = tenantIds.length > 0 ? await readRh(rh, tenantIds) : { establishments: [], devices: [], employees: [] };
      return compareArpWithRh(punches, records, snapshot);
    } finally {
      await rh.end();
    }
  } finally {
    await arp.end();
  }
}
