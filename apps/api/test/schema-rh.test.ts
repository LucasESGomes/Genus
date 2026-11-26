/**
 * Schema rh contra Postgres real: as migrations aplicam e as regras que moram
 * no banco (EXCLUDE, triggers, auditoria só-INSERT, isolamento por conta)
 * recusam o que devem. A conexão usa o search_path padrão de propósito: os
 * triggers precisam achar as tabelas sem depender da sessão.
 */
import { createLogger } from '@genus/shared';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../src/db/client';
import { employees } from '../src/db/schema';
import { startRhTestDatabase, type RhTestDatabase } from './support/rh-database';
import { hashPin, verifyPin } from '../src/modules/employees/pin';
import { FAKE_PIN_HASH, FAKE_PIN_SET_AT } from './support/fake-pin';

let db: RhTestDatabase;
let client: pg.Client;
let seq = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await client.query(sql, params);
  return r.rows[0] as T;
}

async function sqlState(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

interface Org {
  tenantId: number;
  companyId: number;
  establishmentId: number;
  jobTitleId: number;
  rhUserId: number;
  managerUserId: number;
}

/** Conta completa: empresa, estabelecimento em São Paulo/SP, cargo e dois usuários. */
async function createOrg(name: string): Promise<Org> {
  seq += 1;
  const tenantId = (await one<{ id: number }>('INSERT INTO rh.contas (nome) VALUES ($1) RETURNING id', [name])).id;
  const companyId = (
    await one<{ id: number }>('INSERT INTO rh.empresas (conta_id, razao_social, cnpj) VALUES ($1, $2, $3) RETURNING id', [
      tenantId,
      `${name} Ltda`,
      String(12_345_678_000_100 + seq),
    ])
  ).id;
  const establishmentId = (
    await one<{ id: number }>(
      `INSERT INTO rh.estabelecimentos (conta_id, empresa_id, nome, tipo_inscricao, inscricao, uf, municipio_ibge)
       VALUES ($1, $2, 'Matriz', 'CNPJ', $3, 'SP', '3550308') RETURNING id`,
      [tenantId, companyId, String(12_345_678_000_100 + seq)],
    )
  ).id;
  const jobTitleId = (
    await one<{ id: number }>("INSERT INTO rh.cargos (conta_id, empresa_id, nome) VALUES ($1, $2, 'Vendedor') RETURNING id", [
      tenantId,
      companyId,
    ])
  ).id;
  const user = async (role: string) =>
    (
      await one<{ id: number }>('INSERT INTO rh.usuarios (conta_id, email, nome, papel) VALUES ($1, $2, $3, $4) RETURNING id', [
        tenantId,
        `${role}${seq}@teste.dev`,
        'x',
        role,
      ])
    ).id;
  return { tenantId, companyId, establishmentId, jobTitleId, rhUserId: await user('rh'), managerUserId: await user('gestor') };
}

function insertEmployee(org: Org, cpf: string, establishmentId = org.establishmentId) {
  return client.query(
    `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao, pin_hash, pin_definido_em)
     VALUES ($1, $2, $3, 'Pessoa Fictícia', '1990-01-01', '2025-01-01', $4, $5) RETURNING id`,
    [org.tenantId, establishmentId, cpf, FAKE_PIN_HASH, FAKE_PIN_SET_AT],
  );
}

let org: Org;

/** Setor próprio (limite configurável) + colaboradores com período aquisitivo de 30 dias. */
async function vacationFixture(limit = 1, o: Org = org) {
  seq += 1;
  const dept = await one<{ id: number }>(
    'INSERT INTO rh.setores (conta_id, estabelecimento_id, nome, limite_ferias_simultaneas) VALUES ($1, $2, $3, $4) RETURNING id',
    [o.tenantId, o.establishmentId, `Setor ${seq}`, limit],
  );
  const newEmployee = async () => {
    seq += 1;
    const emp = (await insertEmployee(o, String(10_000_000_000 + seq))).rows[0] as { id: number };
    const period = await one<{ id: number }>(
      `INSERT INTO rh.periodos_aquisitivos_ferias (conta_id, colaborador_id, inicio, fim, concessivo_fim, dias_direito)
       VALUES ($1, $2, '2026-01-01', '2026-12-31', '2027-12-31', 30) RETURNING id`,
      [o.tenantId, emp.id],
    );
    return { org: o, employeeId: emp.id, periodId: period.id };
  };
  return { departmentId: dept.id, newEmployee };
}

function approveVacation(
  e: { org: Org; employeeId: number; periodId: number },
  departmentId: number,
  start: string,
  end: string,
  status = 'aprovada',
) {
  const decided = status === 'solicitada' ? [null, null] : [e.org.rhUserId, '2026-11-20T12:00:00Z'];
  return client.query(
    `INSERT INTO rh.gozos_ferias (conta_id, periodo_aquisitivo_id, colaborador_id, setor_id, data_inicio, data_fim, status,
                                 solicitado_por, decidido_por, decidido_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, dias`,
    [e.org.tenantId, e.periodId, e.employeeId, departmentId, start, end, status, e.org.managerUserId, ...decided],
  );
}

beforeAll(async () => {
  db = await startRhTestDatabase();
  client = new pg.Client({ connectionString: db.url });
  await client.connect();
  org = await createOrg('Conta A');
});

afterAll(async () => {
  await client?.end();
  await db?.stop();
});

describe('migrations', () => {
  it('criam as 44 tabelas, a view e as extensões', async () => {
    const tables = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'rh' AND table_type = 'BASE TABLE'",
    );
    expect(tables.n).toBe(44);
    const view = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema = 'rh' AND table_name = 'vw_saldos_banco_horas'",
    );
    expect(view.n).toBe(1);
    const ext = await client.query("SELECT extname FROM pg_extension WHERE extname IN ('btree_gist','citext','unaccent') ORDER BY 1");
    expect(ext.rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'unaccent']);
  });

  it('toda tabela tem conta_id (menos as da plataforma, listadas aqui)', async () => {
    // verificacoes e chaves_jwt são do Better Auth e não guardam dado de conta (0008).
    const without = await client.query(
      `SELECT t.table_name FROM information_schema.tables t
        WHERE t.table_schema = 'rh' AND t.table_type = 'BASE TABLE'
          AND t.table_name NOT IN ('contas', 'verificacoes', 'chaves_jwt')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                           WHERE c.table_schema = 'rh' AND c.table_name = t.table_name AND c.column_name = 'conta_id')`,
    );
    expect(without.rows).toEqual([]);
  });

  it('e-mail do usuário não diferencia maiúsculas (citext)', async () => {
    expect(
      await sqlState(
        client.query("INSERT INTO rh.usuarios (conta_id, email, nome, papel) VALUES ($1, 'RH1@Teste.dev', 'RH 1', 'rh')", [org.tenantId]),
      ),
    ).toBe('23505');
  });
});

describe('multi-tenant', () => {
  it('o mesmo CPF existe uma vez por conta, não uma vez no sistema', async () => {
    const other = await createOrg('Conta B');
    await insertEmployee(org, '55566677788');
    await insertEmployee(other, '55566677788');
    expect(await sqlState(insertEmployee(org, '55566677788'))).toBe('23505');
  });

  it('recusa ligar linhas de contas diferentes (FK composta)', async () => {
    const other = await createOrg('Conta C');
    // colaborador da conta C num estabelecimento da conta A
    expect(await sqlState(insertEmployee(other, '11122233344', org.establishmentId))).toBe('23503');
    // vínculo da conta A com o cargo da conta C
    const emp = (await insertEmployee(org, '11122233345')).rows[0] as { id: number };
    const dept = await one<{ id: number }>(
      "INSERT INTO rh.setores (conta_id, estabelecimento_id, nome) VALUES ($1, $2, 'Isolamento') RETURNING id",
      [org.tenantId, org.establishmentId],
    );
    expect(
      await sqlState(
        client.query(
          `INSERT INTO rh.vinculos_colaborador (conta_id, colaborador_id, cargo_id, setor_id, tipo_contrato, vigencia_inicio)
           VALUES ($1, $2, $3, $4, 'indeterminado', '2025-01-01')`,
          [org.tenantId, emp.id, other.jobTitleId, dept.id],
        ),
      ),
    ).toBe('23503');
  });

  it('só o super_admin fica sem conta', async () => {
    await client.query("INSERT INTO rh.usuarios (email, nome, papel, mfa_ativo) VALUES ('root@genus.dev', 'Root', 'super_admin', true)");
    expect(await sqlState(client.query("INSERT INTO rh.usuarios (email, nome, papel) VALUES ('semconta@teste.dev', 'Sem conta', 'rh')"))).toBe(
      '23514',
    );
  });
});

describe('Drizzle', () => {
  let handle: DatabaseHandle;
  beforeAll(() => {
    handle = createDatabase(db.url, createLogger({ level: 'silent', service: 'test' }));
  });
  afterAll(async () => handle?.close());

  it('lê e grava com propriedades em inglês sobre colunas em português', async () => {
    const [inserted] = await handle.db
      .insert(employees)
      .values({
        tenantId: org.tenantId,
        establishmentId: org.establishmentId,
        cpf: '98765432100',
        name: 'Maria Drizzle',
        birthDate: '1995-05-05',
        admissionDate: '2024-02-01',
        pinHash: FAKE_PIN_HASH,
        pinSetAt: new Date(FAKE_PIN_SET_AT),
      })
      .returning();
    expect(inserted?.id).toBeTypeOf('number');
    const [found] = await handle.db
      .select()
      .from(employees)
      .where(and(eq(employees.tenantId, org.tenantId), eq(employees.cpf, '98765432100')));
    expect(found).toMatchObject({ name: 'Maria Drizzle', admissionDate: '2024-02-01', terminationDate: null });
  });
});

describe('vigências sem sobreposição (EXCLUDE)', () => {
  it('recusa dois vínculos valendo no mesmo dia', async () => {
    const { departmentId, newEmployee } = await vacationFixture();
    const e = await newEmployee();
    const insert = (from: string, to: string | null) =>
      client.query(
        `INSERT INTO rh.vinculos_colaborador (conta_id, colaborador_id, cargo_id, setor_id, tipo_contrato, vigencia_inicio, vigencia_fim)
         VALUES ($1, $2, $3, $4, 'indeterminado', $5, $6)`,
        [org.tenantId, e.employeeId, org.jobTitleId, departmentId, from, to],
      );
    await insert('2025-01-01', '2025-12-31');
    expect(await sqlState(insert('2025-12-31', null))).toBe('23P01');
    await insert('2026-01-01', null);
  });
});

describe('férias', () => {
  it('calcula dias pela coluna gerada', async () => {
    const { departmentId, newEmployee } = await vacationFixture();
    const r = await approveVacation(await newEmployee(), departmentId, '2027-01-04', '2027-01-18');
    expect(r.rows[0].dias).toBe(15);
  });

  it('REGRA 2: setor com limite 1 não aprova duas férias sobrepostas', async () => {
    const { departmentId, newEmployee } = await vacationFixture(1);
    await approveVacation(await newEmployee(), departmentId, '2027-01-04', '2027-01-18');
    const other = await newEmployee();
    expect(await sqlState(approveVacation(other, departmentId, '2027-01-11', '2027-01-25'))).toBe('23514');
    // solicitar pode; só a aprovação conta
    await approveVacation(other, departmentId, '2027-01-11', '2027-01-25', 'solicitada');
  });

  it('REGRA 2: com limite 2, duas pessoas podem sobrepor; a terceira não', async () => {
    const { departmentId, newEmployee } = await vacationFixture(2);
    await approveVacation(await newEmployee(), departmentId, '2027-01-04', '2027-01-18');
    await approveVacation(await newEmployee(), departmentId, '2027-01-05', '2027-01-19');
    expect(await sqlState(approveVacation(await newEmployee(), departmentId, '2027-01-06', '2027-01-20'))).toBe('23514');
  });

  it('REGRA 3: não passa do direito do período aquisitivo', async () => {
    const { departmentId, newEmployee } = await vacationFixture();
    const e = await newEmployee();
    await approveVacation(e, departmentId, '2027-01-04', '2027-01-25'); // 22 dias
    expect(await sqlState(approveVacation(e, departmentId, '2027-03-01', '2027-03-10'))).toBe('23514'); // +10 = 32
  });

  it('REGRA 4: não começa nos 2 dias antes do descanso semanal', async () => {
    const { departmentId, newEmployee } = await vacationFixture();
    // 07/01/2027 é quinta: o sábado cai em D+2
    expect(await sqlState(approveVacation(await newEmployee(), departmentId, '2027-01-07', '2027-01-21'))).toBe('23514');
  });

  it('REGRA 4: feriado municipal de outra cidade não bloqueia; o da cidade do estabelecimento bloqueia', async () => {
    const { departmentId, newEmployee } = await vacationFixture();
    // Campinas (3509502), terça 02/02/2027
    await client.query(
      "INSERT INTO rh.feriados (abrangencia, uf, municipio_ibge, data, nome) VALUES ('municipal', 'SP', '3509502', '2027-02-02', 'Feriado de Campinas')",
    );
    await approveVacation(await newEmployee(), departmentId, '2027-02-01', '2027-02-15');
    // São Paulo (3550308), terça 02/03/2027
    await client.query(
      "INSERT INTO rh.feriados (abrangencia, uf, municipio_ibge, data, nome) VALUES ('municipal', 'SP', '3550308', '2027-03-02', 'Feriado de São Paulo')",
    );
    expect(await sqlState(approveVacation(await newEmployee(), departmentId, '2027-03-01', '2027-03-15'))).toBe('23514');
  });

  it('REGRA 4: feriado próprio de outra conta não bloqueia', async () => {
    const other = await createOrg('Conta D');
    // terça 06/04/2027, só da conta D, mesma cidade
    await client.query(
      "INSERT INTO rh.feriados (conta_id, abrangencia, uf, municipio_ibge, data, nome) VALUES ($1, 'municipal', 'SP', '3550308', '2027-04-06', 'Data da conta D')",
      [other.tenantId],
    );
    const mine = await vacationFixture();
    await approveVacation(await mine.newEmployee(), mine.departmentId, '2027-04-05', '2027-04-19');
    const theirs = await vacationFixture(1, other);
    expect(await sqlState(approveVacation(await theirs.newEmployee(), theirs.departmentId, '2027-04-05', '2027-04-19'))).toBe('23514');
  });
});

describe('período fechado (RF46)', () => {
  it('recusa apuração dentro do período e não deixa mover a linha para fora dele', async () => {
    const { newEmployee } = await vacationFixture();
    const e = await newEmployee();
    const day = await one<{ id: number }>(
      `INSERT INTO rh.apuracoes_dia (conta_id, colaborador_id, data, situacao, parametro_versao)
       VALUES ($1, $2, '2026-10-15', 'normal', 'v1') RETURNING id`,
      [org.tenantId, e.employeeId],
    );
    await client.query(
      `INSERT INTO rh.fechamentos (conta_id, estabelecimento_id, competencia, data_inicio, data_fim, status, fechado_por, fechado_em)
       VALUES ($1, $2, '2026-10-01', '2026-10-01', '2026-10-31', 'fechado', $3, now())`,
      [org.tenantId, org.establishmentId, org.rhUserId],
    );
    expect(
      await sqlState(
        client.query(
          "INSERT INTO rh.apuracoes_dia (conta_id, colaborador_id, data, situacao, parametro_versao) VALUES ($1, $2, '2026-10-16', 'normal', 'v1')",
          [org.tenantId, e.employeeId],
        ),
      ),
    ).toBe('23514');
    expect(await sqlState(client.query("UPDATE rh.apuracoes_dia SET data = '2026-11-15' WHERE id = $1", [day.id]))).toBe('23514');
    expect(await sqlState(client.query('DELETE FROM rh.apuracoes_dia WHERE id = $1', [day.id]))).toBe('23514');
  });
});

describe('auditoria (RNF03)', () => {
  it('só aceita INSERT', async () => {
    const row = await one<{ id: number }>(
      "INSERT INTO rh.auditorias (conta_id, usuario_id, entidade, entidade_id, acao) VALUES ($1, $2, 'colaborador', 1, 'criacao') RETURNING id",
      [org.tenantId, org.rhUserId],
    );
    expect(await sqlState(client.query("UPDATE rh.auditorias SET motivo = 'x' WHERE id = $1", [row.id]))).toBe('42501');
    expect(await sqlState(client.query('DELETE FROM rh.auditorias WHERE id = $1', [row.id]))).toBe('42501');
    expect(await sqlState(client.query('TRUNCATE rh.auditorias'))).toBe('42501');
  });
});

describe('banco de horas', () => {
  it('saldo é a soma dos lançamentos', async () => {
    const { newEmployee } = await vacationFixture();
    const e = await newEmployee();
    const add = (tipo: string, minutos: number) =>
      client.query(
        "INSERT INTO rh.lancamentos_banco_horas (conta_id, colaborador_id, tipo, minutos, data_competencia, criado_por) VALUES ($1, $2, $3, $4, '2026-11-01', $5)",
        [org.tenantId, e.employeeId, tipo, minutos, org.rhUserId],
      );
    await add('credito', 120);
    await add('debito', -30);
    expect(await sqlState(add('credito', -10))).toBe('23514');
    const saldo = await one<{ saldo_minutos: string }>(
      'SELECT saldo_minutos FROM rh.vw_saldos_banco_horas WHERE conta_id = $1 AND colaborador_id = $2',
      [org.tenantId, e.employeeId],
    );
    expect(Number(saldo.saldo_minutos)).toBe(90);
  });
});

describe('PIN do colaborador (migration 0003)', () => {
  const insertWithPin = (cpf: string, pinHash: string | null, pinSetAt: string | null) =>
    client.query(
      `INSERT INTO rh.colaboradores (conta_id, estabelecimento_id, cpf, nome, data_nascimento, data_admissao, pin_hash, pin_definido_em)
       VALUES ($1, $2, $3, 'Pessoa Fictícia', '1990-01-01', '2025-01-01', $4, $5) RETURNING id`,
      [org.tenantId, org.establishmentId, cpf, pinHash, pinSetAt],
    );
  const nextCpf = () => {
    seq += 1;
    return String(20_000_000_000 + seq);
  };

  it('todo colaborador tem PIN: sem hash ou sem data, recusa', async () => {
    expect(await sqlState(insertWithPin(nextCpf(), null, FAKE_PIN_SET_AT))).toBe('23502');
    expect(await sqlState(insertWithPin(nextCpf(), FAKE_PIN_HASH, null))).toBe('23502');
    const id = ((await insertWithPin(nextCpf(), FAKE_PIN_HASH, FAKE_PIN_SET_AT)).rows[0] as { id: number }).id;
    expect(await sqlState(client.query('UPDATE rh.colaboradores SET pin_hash = NULL WHERE id = $1', [id]))).toBe('23502');
  });

  it('recusa PIN em claro ou hash de outro formato', async () => {
    for (const value of ['1234', '482915', 'bcrypt$2b$10$abc', 'scrypt$1$2$3', 'scrypt$1$32768$8$1$sal$hash com espaço']) {
      expect(await sqlState(insertWithPin(nextCpf(), value, FAKE_PIN_SET_AT)), value).toBe('23514');
    }
  });

  it('aceita o hash gerado por hashPin', async () => {
    const pepper = { version: 1, key: Buffer.alloc(32, 7) };
    const hash = await hashPin('482915', pepper);
    const id = ((await insertWithPin(nextCpf(), hash, FAKE_PIN_SET_AT)).rows[0] as { id: number }).id;
    const row = await one<{ pin_hash: string }>('SELECT pin_hash FROM rh.colaboradores WHERE id = $1', [id]);
    expect(await verifyPin('482915', row.pin_hash, [pepper])).toBe(true);
  });
});
