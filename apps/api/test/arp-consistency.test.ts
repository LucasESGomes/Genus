/**
 * Conferência arp x RH. Regra pura por tabela, e o mesmo fluxo ponta a ponta:
 * banco arp real (migrations do ponto, via @genus/db-arp) + banco app real,
 * lendo o arp com o papel somente leitura.
 */
import pg from 'pg';
import { startArpTestDatabase, type ArpTestDatabase } from '@genus/db-arp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkArp } from '../src/arp/check-arp';
import { compareArpWithRh, type ArpPunchRef, type ArpRecordRef, type RhSnapshot } from '../src/arp/consistency';
import { startRhTestDatabase, type RhTestDatabase } from './support/rh-database';

const rh: RhSnapshot = {
  establishments: [{ tenantId: 1, id: 10 }],
  devices: [{ tenantId: 1, id: 100, establishmentId: 10 }],
  employees: [{ tenantId: 1, id: 1000, cpf: '12345678901' }],
};
const ok: ArpPunchRef = { tenantId: 1, establishmentId: 10, deviceId: 100, employeeId: 1000, cpf: '12345678901' };

describe('compareArpWithRh', () => {
  const cases: { name: string; punches?: ArpPunchRef[]; records?: ArpRecordRef[]; types: string[] }[] = [
    { name: 'tudo bate', punches: [ok], records: [{ tenantId: 1, establishmentId: 10, cpf: '12345678901' }], types: [] },
    { name: 'estabelecimento que o RH não tem', punches: [{ ...ok, establishmentId: 11 }], types: ['estabelecimento_desconhecido', 'aparelho_de_outro_estabelecimento'] },
    { name: 'aparelho que o RH não tem', punches: [{ ...ok, deviceId: 101 }], types: ['aparelho_desconhecido'] },
    { name: 'colaborador que o RH não tem', punches: [{ ...ok, employeeId: 1001 }], types: ['colaborador_desconhecido'] },
    { name: 'mesmo colaborador com outro CPF', punches: [{ ...ok, cpf: '99999999999' }], types: ['cpf_divergente'] },
    {
      name: 'mesmos IDs, mas de outra conta',
      punches: [{ ...ok, tenantId: 2 }],
      types: ['estabelecimento_desconhecido', 'aparelho_desconhecido', 'colaborador_desconhecido'],
    },
    { name: 'registro com CPF sem colaborador na conta', records: [{ tenantId: 1, establishmentId: 10, cpf: '00000000000' }], types: ['cpf_sem_colaborador'] },
    { name: 'registro sem CPF (tipos 2/4/5/6)', records: [{ tenantId: 1, establishmentId: 10, cpf: null }], types: [] },
    { name: 'a mesma divergência aparece uma vez só', punches: [{ ...ok, employeeId: 1001 }, { ...ok, employeeId: 1001 }], types: ['colaborador_desconhecido'] },
  ];

  it.each(cases)('$name', ({ punches = [], records = [], types }) => {
    expect(compareArpWithRh(punches, records, rh).map((f) => f.type)).toEqual(types);
  });
});

describe('checkArp (dois bancos reais)', () => {
  let arp: ArpTestDatabase;
  let app: RhTestDatabase;
  let ids: { tenantId: number; establishmentId: number; deviceId: number; employeeId: number };

  beforeAll(async () => {
    [arp, app] = await Promise.all([startArpTestDatabase(), startRhTestDatabase()]);
    const c = new pg.Client({ connectionString: app.url });
    await c.connect();
    try {
      const one = async (sql: string, params: unknown[]) => Number((await c.query<{ id: string }>(sql, params)).rows[0]?.id);
      const tenantId = await one("INSERT INTO rh.conta (nome) VALUES ('Conta') RETURNING id", []);
      const companyId = await one("INSERT INTO rh.empresa (conta_id, razao_social, cnpj) VALUES ($1, 'E', '11222333000181') RETURNING id", [tenantId]);
      const establishmentId = await one(
        `INSERT INTO rh.estabelecimento (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge)
         VALUES ($1, $2, 'Matriz', 'CNPJ', '11222333000181', 'SP', '3550308') RETURNING id`,
        [tenantId, companyId],
      );
      const deviceId = await one("INSERT INTO rh.aparelho (conta_id, estabelecimento_id, nome) VALUES ($1, $2, 'Tablet 1') RETURNING id", [
        tenantId,
        establishmentId,
      ]);
      const employeeId = await one(
        `INSERT INTO rh.colaborador (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao)
         VALUES ($1, $2, '12345678901', 'Pessoa Fictícia', '1990-01-01', '2025-01-01') RETURNING id`,
        [tenantId, establishmentId],
      );
      ids = { tenantId, establishmentId, deviceId, employeeId };
    } finally {
      await c.end();
    }
  });

  afterAll(async () => {
    await Promise.all([arp?.stop(), app?.stop()]);
  });

  /** Uma batida como a api do coletor grava (papel arp_collector, só INSERT em entradas). */
  async function punch(over: { employeeId?: number; cpf?: string }, seq: number) {
    const c = new pg.Client({ connectionString: arp.collectorUrl });
    await c.connect();
    try {
      await c.query(
        `INSERT INTO entradas (conta_id, estabelecimento_id, aparelho_id, sequencia_aparelho, colaborador_id, cpf,
                               marcado_em, recebido_em, metodo_identificacao)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-11-20T12:00:00Z', '2026-11-20T12:00:01Z', 'facial')`,
        [ids.tenantId, ids.establishmentId, ids.deviceId, seq, over.employeeId ?? ids.employeeId, over.cpf ?? '12345678901'],
      );
    } finally {
      await c.end();
    }
  }

  it('sem divergência quando a batida usa os IDs do RH', async () => {
    await punch({}, 1);
    expect(await checkArp(arp.readerUrl, app.url)).toEqual([]);
  });

  it('aponta colaborador inexistente e CPF trocado', async () => {
    await punch({ employeeId: 999_999 }, 2);
    await punch({ cpf: '98765432100' }, 3);
    const types = (await checkArp(arp.readerUrl, app.url)).map((f) => f.type).sort();
    expect(types).toEqual(['colaborador_desconhecido', 'cpf_divergente']);
  });
});
