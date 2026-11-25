/**
 * Agregados do banco `app` para o painel do super_admin. Só contagens: nada de conteúdo
 * (atestado, ajuste, CID) nem de colaborador. Poucas consultas com GROUP BY; sem N+1.
 *
 * `tenantId` null = todas as contas (só o super_admin chega aqui).
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../../../db/client';

export interface ScopeCounts {
  employees: number;
  devicesTotal: number;
  devicesActive: number;
  users: number;
  pendingClosings: number;
  adjustments: number;
  certificates: number;
  vacations: number;
  absences: number;
  closings: number;
}

export interface TenantTotals {
  total: number;
  active: number;
}

const num = (v: unknown) => Number(v ?? 0);

export class StatsRepository {
  constructor(private readonly db: Database) {}

  async tenantExists(tenantId: number): Promise<boolean> {
    const r = await this.db.execute(sql`SELECT 1 FROM rh.contas WHERE id = ${tenantId}`);
    return r.rows.length > 0;
  }

  async tenantTotals(): Promise<TenantTotals> {
    const r = await this.db.execute(sql`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE ativo) AS active FROM rh.contas`);
    const row = r.rows[0] ?? {};
    return { total: num(row.total), active: num(row.active) };
  }

  /**
   * Contagens do escopo. "Uso" dos módulos = linhas criadas na janela: ajustes (`solicitado_em`),
   * atestados (`enviado_em`), férias (`gozos_ferias.solicitado_em`), fechamentos (`fechado_em`) e
   * afastamentos (`data_inicio`, que não têm instante de criação). Colaborador ativo = sem `data_desligamento`.
   */
  async scopeCounts(tenantId: number | null, from: Date, to: Date): Promise<ScopeCounts> {
    const fromDay = from.toISOString().slice(0, 10);
    const toDay = to.toISOString().slice(0, 10);
    const t = sql`${tenantId}::bigint`;
    const r = await this.db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM rh.colaboradores WHERE data_desligamento IS NULL AND (${t} IS NULL OR conta_id = ${t})) AS employees,
        (SELECT COUNT(*) FROM rh.aparelhos WHERE ${t} IS NULL OR conta_id = ${t}) AS devices_total,
        (SELECT COUNT(*) FROM rh.aparelhos WHERE ativo AND (${t} IS NULL OR conta_id = ${t})) AS devices_active,
        (SELECT COUNT(*) FROM rh.usuarios WHERE conta_id IS NOT NULL AND ativo AND (${t} IS NULL OR conta_id = ${t})) AS users,
        (SELECT COUNT(*) FROM rh.fechamentos WHERE status <> 'fechado' AND (${t} IS NULL OR conta_id = ${t})) AS pending_closings,
        (SELECT COUNT(*) FROM rh.ajustes WHERE solicitado_em >= ${from} AND solicitado_em < ${to} AND (${t} IS NULL OR conta_id = ${t})) AS adjustments,
        (SELECT COUNT(*) FROM rh.atestados WHERE enviado_em >= ${from} AND enviado_em < ${to} AND (${t} IS NULL OR conta_id = ${t})) AS certificates,
        (SELECT COUNT(*) FROM rh.gozos_ferias WHERE solicitado_em >= ${from} AND solicitado_em < ${to} AND (${t} IS NULL OR conta_id = ${t})) AS vacations,
        (SELECT COUNT(*) FROM rh.afastamentos WHERE data_inicio >= ${fromDay}::date AND data_inicio <= ${toDay}::date AND (${t} IS NULL OR conta_id = ${t})) AS absences,
        (SELECT COUNT(*) FROM rh.fechamentos WHERE fechado_em >= ${from} AND fechado_em < ${to} AND (${t} IS NULL OR conta_id = ${t})) AS closings
    `);
    const row = r.rows[0] ?? {};
    return {
      employees: num(row.employees),
      devicesTotal: num(row.devices_total),
      devicesActive: num(row.devices_active),
      users: num(row.users),
      pendingClosings: num(row.pending_closings),
      adjustments: num(row.adjustments),
      certificates: num(row.certificates),
      vacations: num(row.vacations),
      absences: num(row.absences),
      closings: num(row.closings),
    };
  }

  /** Nome e colaboradores ativos das contas dadas (uma consulta para todas). */
  async tenantSummaries(tenantIds: readonly number[]): Promise<Map<number, { name: string; employees: number }>> {
    if (tenantIds.length === 0) return new Map();
    const ids = sql.join(tenantIds.map((id) => sql`${id}`), sql`, `);
    const r = await this.db.execute(sql`
      SELECT c.id, c.nome AS name,
             (SELECT COUNT(*) FROM rh.colaboradores e WHERE e.conta_id = c.id AND e.data_desligamento IS NULL) AS employees
        FROM rh.contas c
       WHERE c.id IN (${ids})
    `);
    return new Map(r.rows.map((row) => [num(row.id), { name: String(row.name), employees: num(row.employees) }]));
  }

  /**
   * Crescimento mensal (UTC). Contas por `criado_em`. Colaboradores por `data_admissao`: a tabela não
   * tem `criado_em`, e a admissão é o que o RH entende como "entrou na plataforma". Admissões futuras
   * (depois do mês corrente) ficam de fora.
   */
  async growth(start: Date, endExclusive: Date): Promise<{
    tenantsBefore: number;
    tenantsByMonth: { month: string; count: number }[];
    employeesBefore: number;
    employeesByMonth: { month: string; count: number }[];
  }> {
    const startDay = start.toISOString().slice(0, 10);
    const endDay = endExclusive.toISOString().slice(0, 10);
    const [tBefore, tMonths, eBefore, eMonths] = await Promise.all([
      this.db.execute(sql`SELECT COUNT(*) AS n FROM rh.contas WHERE criado_em < ${start}`),
      this.db.execute(sql`
        SELECT to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM') AS month, COUNT(*) AS n
          FROM rh.contas WHERE criado_em >= ${start} AND criado_em < ${endExclusive} GROUP BY 1`),
      this.db.execute(sql`SELECT COUNT(*) AS n FROM rh.colaboradores WHERE data_admissao < ${startDay}::date`),
      this.db.execute(sql`
        SELECT to_char(data_admissao, 'YYYY-MM') AS month, COUNT(*) AS n
          FROM rh.colaboradores WHERE data_admissao >= ${startDay}::date AND data_admissao < ${endDay}::date GROUP BY 1`),
    ]);
    const months = (rows: { month?: unknown; n?: unknown }[]) => rows.map((r) => ({ month: String(r.month), count: num(r.n) }));
    return {
      tenantsBefore: num(tBefore.rows[0]?.n),
      tenantsByMonth: months(tMonths.rows),
      employeesBefore: num(eBefore.rows[0]?.n),
      employeesByMonth: months(eMonths.rows),
    };
  }
}
