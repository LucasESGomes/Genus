/**
 * Acesso a dados das contas (tenants) para o painel do super_admin. Toda função recebe o executor
 * (banco ou transação). Aqui o `conta_id` é o próprio alvo da consulta: só o super_admin chega aqui.
 *
 * As contagens da lista saem de subconsultas correlacionadas (uma ida ao banco, sem N+1). Nenhuma coluna
 * cifrada nem hash é lida: a DEK da empresa só é inserida, e `hasCompanyKey` olha a existência da linha.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Executor } from '../../../db/executor';
import { companies, companyKeys, establishments, sessions, tenants, users } from '../../../db/schema';
import { escapeLike } from '../../../http/search';
import type { StoredCompanyKey } from '../../facial/stored-crypto';

export interface TenantRow {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  suspendedAt: Date | null;
  suspensionReason: string | null;
  counts: { employees: number; devices: number; users: number; establishments: number };
}

export interface TenantCompanyRow {
  id: number;
  legalName: string;
  cnpj: string;
  isActive: boolean;
}

export interface TenantAdminRow {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  mfaEnabled: boolean;
}

export interface ListFilter {
  q?: string | undefined;
  status?: 'ativa' | 'suspensa' | undefined;
  page: number;
  pageSize: number;
}

export interface NewEstablishment {
  name: string;
  registrationType: 'CNPJ' | 'CPF' | 'CAEPF';
  registration: string;
  uf: string;
  municipalityIbge: string;
}

type RawTenant = {
  id: string | number;
  nome: string;
  ativo: boolean;
  criado_em: Date;
  atualizado_em: Date;
  suspensa_em: Date | null;
  motivo_suspensao: string | null;
  colaboradores: number;
  aparelhos: number;
  usuarios: number;
  estabelecimentos: number;
};

/** Colunas da conta + contagens. `c` é o alias de rh.contas. */
const TENANT_COLUMNS = sql`
  c.id, c.nome, c.ativo, c.criado_em, c.atualizado_em, c.suspensa_em, c.motivo_suspensao,
  (SELECT count(*)::int FROM rh.colaboradores x WHERE x.conta_id = c.id AND x.data_desligamento IS NULL) AS colaboradores,
  (SELECT count(*)::int FROM rh.aparelhos x WHERE x.conta_id = c.id) AS aparelhos,
  (SELECT count(*)::int FROM rh.usuarios x WHERE x.conta_id = c.id) AS usuarios,
  (SELECT count(*)::int FROM rh.estabelecimentos x WHERE x.conta_id = c.id) AS estabelecimentos`;

function toRow(r: RawTenant): TenantRow {
  return {
    id: Number(r.id),
    name: r.nome,
    isActive: r.ativo,
    createdAt: new Date(r.criado_em),
    updatedAt: new Date(r.atualizado_em),
    suspendedAt: r.suspensa_em === null ? null : new Date(r.suspensa_em),
    suspensionReason: r.motivo_suspensao,
    counts: { employees: r.colaboradores, devices: r.aparelhos, users: r.usuarios, establishments: r.estabelecimentos },
  };
}

export class TenantRepository {
  async list(ex: Executor, f: ListFilter): Promise<{ rows: TenantRow[]; total: number }> {
    const where = [sql`true`];
    if (f.q) where.push(sql`unaccent(c.nome) ILIKE unaccent(${`%${escapeLike(f.q)}%`})`);
    if (f.status === 'ativa') where.push(sql`c.ativo`);
    if (f.status === 'suspensa') where.push(sql`NOT c.ativo`);
    const cond = sql.join(where, sql` AND `);

    const total = await ex.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM rh.contas c WHERE ${cond}`);
    const page = await ex.execute<RawTenant>(
      sql`SELECT ${TENANT_COLUMNS} FROM rh.contas c WHERE ${cond} ORDER BY c.id DESC LIMIT ${f.pageSize} OFFSET ${(f.page - 1) * f.pageSize}`,
    );
    return { rows: page.rows.map(toRow), total: total.rows[0]?.total ?? 0 };
  }

  async get(ex: Executor, tenantId: number, lock = false): Promise<TenantRow | undefined> {
    const res = await ex.execute<RawTenant>(
      sql`SELECT ${TENANT_COLUMNS} FROM rh.contas c WHERE c.id = ${tenantId} ${lock ? sql`FOR UPDATE OF c` : sql``}`,
    );
    return res.rows[0] ? toRow(res.rows[0]) : undefined;
  }

  async companiesOf(ex: Executor, tenantId: number): Promise<TenantCompanyRow[]> {
    return ex
      .select({ id: companies.id, legalName: companies.legalName, cnpj: companies.cnpj, isActive: companies.isActive })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .orderBy(asc(companies.id))
      .then((rows) => rows.map((r) => ({ ...r, id: Number(r.id) })));
  }

  /** Usuários do cliente com papel de gestão do portal (admin e rh). Sem colaborador_id, sem hash. */
  async adminsOf(ex: Executor, tenantId: number): Promise<TenantAdminRow[]> {
    const rows = await ex
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, mfaEnabled: users.mfaEnabled })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), sql`${users.role} IN ('admin', 'rh')`))
      .orderBy(asc(users.id));
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  async hasCompanyKey(ex: Executor, tenantId: number): Promise<boolean> {
    const [row] = await ex
      .select({ id: companyKeys.id })
      .from(companyKeys)
      .where(and(eq(companyKeys.tenantId, tenantId), eq(companyKeys.isActive, true)))
      .limit(1);
    return row !== undefined;
  }

  async emailExists(ex: Executor, email: string): Promise<boolean> {
    const [row] = await ex.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    return row !== undefined;
  }

  // ---- criação (estrutura da conta) -----------------------------------------------------------

  async findTenantByName(ex: Executor, name: string): Promise<number | undefined> {
    const [row] = await ex.select({ id: tenants.id }).from(tenants).where(eq(tenants.name, name)).limit(1);
    return row ? Number(row.id) : undefined;
  }

  async insertTenant(ex: Executor, name: string): Promise<number> {
    const [row] = await ex.insert(tenants).values({ name }).returning({ id: tenants.id });
    return Number(row!.id);
  }

  async findCompanyByCnpj(ex: Executor, tenantId: number, cnpj: string): Promise<number | undefined> {
    const [row] = await ex
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.cnpj, cnpj)))
      .limit(1);
    return row ? Number(row.id) : undefined;
  }

  async insertCompany(ex: Executor, tenantId: number, legalName: string, cnpj: string): Promise<number> {
    const [row] = await ex.insert(companies).values({ tenantId, legalName, cnpj }).returning({ id: companies.id });
    return Number(row!.id);
  }

  async findEstablishment(ex: Executor, companyId: number, registration: string): Promise<number | undefined> {
    const [row] = await ex
      .select({ id: establishments.id })
      .from(establishments)
      .where(and(eq(establishments.companyId, companyId), eq(establishments.registration, registration)))
      .limit(1);
    return row ? Number(row.id) : undefined;
  }

  async insertEstablishment(ex: Executor, tenantId: number, companyId: number, e: NewEstablishment): Promise<number> {
    const [row] = await ex
      .insert(establishments)
      .values({ tenantId, companyId, name: e.name, registrationType: e.registrationType, registration: e.registration, uf: e.uf, municipalityIbge: e.municipalityIbge })
      .returning({ id: establishments.id });
    return Number(row!.id);
  }

  async hasActiveKeyForCompany(ex: Executor, tenantId: number, companyId: number): Promise<boolean> {
    const [row] = await ex
      .select({ id: companyKeys.id })
      .from(companyKeys)
      .where(and(eq(companyKeys.tenantId, tenantId), eq(companyKeys.companyId, companyId), eq(companyKeys.isActive, true)))
      .limit(1);
    return row !== undefined;
  }

  async insertCompanyKey(ex: Executor, tenantId: number, companyId: number, key: StoredCompanyKey): Promise<void> {
    await ex.insert(companyKeys).values({
      tenantId,
      companyId,
      keyVersion: key.keyVersion,
      dekIv: key.dekIv,
      dekTag: key.dekTag,
      dekCt: key.dekCt,
      masterKeyVersion: key.masterKeyVersion,
    });
  }

  // ---- alteração -----------------------------------------------------------------------------

  async rename(ex: Executor, tenantId: number, name: string): Promise<void> {
    await ex.update(tenants).set({ name }).where(eq(tenants.id, tenantId));
  }

  async suspend(ex: Executor, tenantId: number, by: { userId: number; at: Date; reason: string }): Promise<void> {
    await ex
      .update(tenants)
      .set({ isActive: false, suspendedAt: by.at, suspendedById: by.userId, suspensionReason: by.reason })
      .where(eq(tenants.id, tenantId));
    // O trigger da 0015 já apaga as sessões; repetir aqui deixa a regra explícita e independente dele.
    await ex.delete(sessions).where(eq(sessions.tenantId, tenantId));
  }

  async reactivate(ex: Executor, tenantId: number): Promise<void> {
    await ex
      .update(tenants)
      .set({ isActive: true, suspendedAt: null, suspendedById: null, suspensionReason: null })
      .where(eq(tenants.id, tenantId));
  }
}
