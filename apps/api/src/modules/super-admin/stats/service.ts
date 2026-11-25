import { HttpError } from '../../../plugins/error-handler';
import type { RequestContext } from '../../../plugins/request-context';
import { recordAudit } from '../../audit/audit';
import type { StatsWindow } from '../contract';
import type { SuperAdminDeps } from '../deps';
import { buildGrowth, growthStart, lastMonths, processedRate, topByPunches, totalizePunches, windowRange } from './rules/aggregate';
import { StatsRepository, type ScopeCounts } from './repository';

const TOP_TENANTS = 5;

const moduleUsage = (c: ScopeCounts) => ({
  adjustments: c.adjustments,
  certificates: c.certificates,
  vacations: c.vacations,
  absences: c.absences,
  closings: c.closings,
});

export class StatsService {
  private readonly repo: StatsRepository;

  constructor(private readonly deps: SuperAdminDeps) {
    this.repo = new StatsRepository(deps.db);
  }

  async overview(window: StatsWindow) {
    const { from, to } = windowRange(window, this.deps.clock.now());
    const [tenants, counts, rows] = await Promise.all([
      this.repo.tenantTotals(),
      this.repo.scopeCounts(null, from, to),
      this.deps.arpOps.punchesPerDay({ tenantId: null, from, to }),
    ]);
    const punches = totalizePunches(rows, from, to);
    const top = topByPunches(punches.perTenant, TOP_TENANTS);
    const summaries = await this.repo.tenantSummaries(top.map((t) => t.tenantId));
    return {
      window,
      tenants: { total: tenants.total, active: tenants.active, suspended: tenants.total - tenants.active },
      employees: counts.employees,
      devices: { total: counts.devicesTotal, active: counts.devicesActive },
      users: counts.users,
      punches: punches.punches,
      punchesPerDay: punches.perDay,
      processedRate: processedRate(punches.processed, punches.punches),
      pendingClosings: counts.pendingClosings,
      moduleUsage: moduleUsage(counts),
      // Conta que só existe no arp (sem linha em `contas`) não aparece: não há nome para mostrar.
      topTenants: top.flatMap((t) => {
        const s = summaries.get(t.tenantId);
        return s ? [{ tenantId: t.tenantId, name: s.name, punches: t.punches, employees: s.employees }] : [];
      }),
    };
  }

  /** Leitura entre contas: grava uma linha `leitura_sensivel` (04 §1.4, contrato). */
  async tenant(ctx: RequestContext, tenantId: number, window: StatsWindow) {
    if (!(await this.repo.tenantExists(tenantId))) throw new HttpError(404, 'NOT_FOUND', 'Conta não encontrada');
    const { from, to } = windowRange(window, this.deps.clock.now());
    const [counts, rows] = await Promise.all([
      this.repo.scopeCounts(tenantId, from, to),
      this.deps.arpOps.punchesPerDay({ tenantId, from, to }),
    ]);
    const punches = totalizePunches(rows, from, to);
    await recordAudit(this.deps.db, this.deps.clock, {
      tenantId,
      userId: ctx.userId,
      entity: 'tenant_stats',
      entityId: tenantId,
      action: 'leitura_sensivel',
      after: { window },
    });
    return {
      tenantId,
      window,
      employees: counts.employees,
      devices: { total: counts.devicesTotal, active: counts.devicesActive },
      users: counts.users,
      punches: punches.punches,
      punchesPerDay: punches.perDay,
      processedRate: processedRate(punches.processed, punches.punches),
      pendingClosings: counts.pendingClosings,
      moduleUsage: moduleUsage(counts),
    };
  }

  async growth(months: number) {
    const now = this.deps.clock.now();
    const start = growthStart(months, now);
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const g = await this.repo.growth(start, end);
    return buildGrowth(
      lastMonths(months, now),
      { before: g.tenantsBefore, byMonth: g.tenantsByMonth },
      { before: g.employeesBefore, byMonth: g.employeesByMonth },
    );
  }
}
