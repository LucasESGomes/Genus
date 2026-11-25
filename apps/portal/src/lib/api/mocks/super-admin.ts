/**
 * Mock do painel do super_admin. Mesmo contrato de endpoints/super-admin.ts. Dados fictícios, só agregados:
 * nenhum CPF, nome de colaborador ou batida individual. Os IPs usam a faixa de documentação (203.0.113.0/24).
 * Escritas (create, update, suspend, reactivate, revoke) mudam o "banco" em memória; `resetMockSuperAdmin` restaura.
 * Erros no formato da api: 409 TENANT_ALREADY_SUSPENDED / TENANT_NOT_SUSPENDED / EMAIL_IN_USE, 400 CNPJ_INVALIDO.
 */
import { isValidCnpj, onlyDigits } from '../../cnpj';
import type { EntityId } from '../contracts';
import type { SuperAdminApi } from '../endpoints/super-admin';
import type {
  AuditLog, AuditLogDetail, CursorPage, FlaggedIp, GrowthPoint, LoginAttempt, ModuleUsage, Paged, PortalSession, RecognitionDevice,
  RecognitionSeriesPoint, RecognitionSummary, StatsOverview, StatsWindow, SystemHealth, Tenant, TenantAdmin, TenantCompany, TenantDetail,
  TenantStats,
} from '../super-admin-contracts';
import { MOCK_TOTP_CODE } from './index';
import { clone, delay, matchesQuery, mockFail, mockId, mockNotFound, paginate } from './runtime';

/** Instante fixo do mock (mesmo dia de referência do portal). */
const NOW = '2026-11-21T13:00:00.000Z';
const FAKE_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

type TenantRow = TenantDetail;

const seedTenants = (): TenantRow[] => [
  {
    id: '1', name: 'Agropecuária Santa Helena', status: 'ativa', createdAt: '2026-03-02T12:00:00.000Z', updatedAt: '2026-11-10T15:20:00.000Z',
    suspendedAt: null, suspensionReason: null, counts: { employees: 412, devices: 6, users: 9, establishments: 3 }, hasCompanyKey: true,
    companies: [{ id: '11', legalName: 'Agropecuária Santa Helena Ltda', cnpj: '11222333000181', isActive: true }],
    admins: [
      { id: '101', name: 'Lúcia Martins', email: 'lucia@exemplo.test', role: 'rh', isActive: true, mfaEnabled: true },
      { id: '102', name: 'Paulo Andrade', email: 'paulo@exemplo.test', role: 'admin', isActive: true, mfaEnabled: false },
    ],
  },
  {
    id: '2', name: 'Usina Boa Vista', status: 'ativa', createdAt: '2026-05-14T12:00:00.000Z', updatedAt: '2026-11-18T09:05:00.000Z',
    suspendedAt: null, suspensionReason: null, counts: { employees: 238, devices: 4, users: 5, establishments: 1 }, hasCompanyKey: true,
    companies: [{ id: '12', legalName: 'Usina Boa Vista S.A.', cnpj: '44555666000181', isActive: true }],
    admins: [{ id: '103', name: 'Marcos Teixeira', email: 'marcos@exemplo.test', role: 'admin', isActive: true, mfaEnabled: true }],
  },
  {
    id: '3', name: 'Granja São José', status: 'ativa', createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z',
    suspendedAt: null, suspensionReason: null, counts: { employees: 57, devices: 1, users: 2, establishments: 1 }, hasCompanyKey: false,
    companies: [{ id: '13', legalName: 'Granja São José Avicultura Ltda', cnpj: '77888999000181', isActive: true }],
    admins: [{ id: '104', name: 'Renata Lopes', email: 'renata@exemplo.test', role: 'admin', isActive: true, mfaEnabled: false }],
  },
  {
    id: '4', name: 'Cooperativa Vale Verde', status: 'suspensa', createdAt: '2026-01-12T12:00:00.000Z', updatedAt: '2026-11-02T14:00:00.000Z',
    suspendedAt: '2026-11-02T14:00:00.000Z', suspensionReason: 'Inadimplência há mais de 60 dias.',
    counts: { employees: 120, devices: 2, users: 3, establishments: 2 }, hasCompanyKey: true,
    companies: [{ id: '14', legalName: 'Cooperativa Agrícola Vale Verde', cnpj: '12345000000102', isActive: false }],
    admins: [{ id: '105', name: 'Carlos Nogueira', email: 'carlos@exemplo.test', role: 'admin', isActive: false, mfaEnabled: false }],
  },
];

const seedAudit = (): AuditLogDetail[] => {
  const row = (id: string, minutesAgo: number, over: Partial<AuditLogDetail>): AuditLogDetail => ({
    id, tenantId: null, tenantName: null, userId: '900', userEmail: 'superadmin@exemplo.test', entity: 'tenant', entityId: '1',
    action: 'leitura_sensivel', reason: null, createdAt: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString(), before: null, after: null, ...over,
  });
  return [
    row('12', 5, { entity: 'access_log', entityId: '0', after: { filtros: { window: '24h' } } }),
    row('11', 22, { tenantId: '4', tenantName: 'Cooperativa Vale Verde', entity: 'tenant', entityId: '4', action: 'alteracao', reason: 'Inadimplência há mais de 60 dias.',
      before: { ativo: true, motivoSuspensao: null }, after: { ativo: false, motivoSuspensao: 'Inadimplência há mais de 60 dias.' } }),
    row('10', 60, { entity: 'recognition_stats', entityId: '0', after: { filtros: { window: '7d' } } }),
    row('9', 180, { tenantId: '1', tenantName: 'Agropecuária Santa Helena', entity: 'tenant_stats', entityId: '1', after: { filtros: { window: '30d' } } }),
    row('8', 600, { entity: 'audit_log', entityId: '0', after: { filtros: { entity: 'tenant' } } }),
    row('7', 1500, { tenantId: '1', tenantName: 'Agropecuária Santa Helena', userId: '101', userEmail: 'lucia@exemplo.test', entity: 'session', entityId: '55',
      action: 'exclusao', reason: 'Sessão encerrada a pedido do suporte.', before: { ativo: true }, after: null }),
    row('6', 4000, { tenantId: '3', tenantName: 'Granja São José', entity: 'tenant_admin', entityId: '104', action: 'criacao', after: { papel: 'admin', email: '[omitido]' } }),
    row('5', 4010, { tenantId: '3', tenantName: 'Granja São José', entity: 'tenant', entityId: '3', action: 'criacao', after: { nome: 'Granja São José' } }),
    row('4', 9000, { tenantId: '2', tenantName: 'Usina Boa Vista', entity: 'tenant', entityId: '2', action: 'alteracao', before: { nome: 'Usina Boa Vista Energia' }, after: { nome: 'Usina Boa Vista' } }),
    row('3', 12000, { entity: 'super_admin', entityId: '900', action: 'alteracao', tenantId: null, after: { doisFatores: true } }),
    row('2', 20000, { entity: 'super_admin', entityId: '900', action: 'criacao', after: { papel: 'super_admin' } }),
    row('1', 30000, { entity: 'access_log', entityId: '0', after: { filtros: { ip: '203.0.113.45' } } }),
  ];
};

const seedSessions = (): PortalSession[] => {
  const s = (id: string, userId: string, email: string, tenantId: string | null, tenantName: string | null, role: string, ip: string, ago: number, active: boolean): PortalSession => ({
    id, tenantId, tenantName, userId, userEmail: email, role, ipAddress: ip, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0',
    createdAt: new Date(Date.parse(NOW) - ago * 60_000).toISOString(), expiresAt: new Date(Date.parse(NOW) + (active ? 7 : -1) * 3_600_000).toISOString(), isActive: active,
  });
  return [
    s('1', '900', 'superadmin@exemplo.test', null, null, 'super_admin', '198.51.100.10', 12, true),
    s('2', '101', 'lucia@exemplo.test', '1', 'Agropecuária Santa Helena', 'rh', '198.51.100.21', 95, true),
    s('3', '103', 'marcos@exemplo.test', '2', 'Usina Boa Vista', 'admin', '198.51.100.34', 240, true),
    s('4', '104', 'renata@exemplo.test', '3', 'Granja São José', 'admin', '198.51.100.57', 2000, false),
    s('5', '102', 'paulo@exemplo.test', '1', 'Agropecuária Santa Helena', 'admin', '198.51.100.22', 600, true),
  ];
};

const seedAttempts = (): LoginAttempt[] => {
  const a = (id: number, ago: number, ip: string, success: boolean, over: Partial<LoginAttempt> = {}): LoginAttempt => ({
    id: String(id), tenantId: null, userId: null, ipAddress: ip, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0', step: 'senha', success,
    failureReason: success ? null : 'credencial_invalida', createdAt: new Date(Date.parse(NOW) - ago * 60_000).toISOString(), ...over,
  });
  const brute = Array.from({ length: 9 }, (_, i) => a(30 - i, 4 + i * 3, '203.0.113.45', false));
  return [
    ...brute,
    a(20, 30, '198.51.100.21', true, { tenantId: '1', userId: '101' }),
    a(19, 45, '198.51.100.34', false, { tenantId: '2', userId: '103', step: 'totp', failureReason: 'totp_invalido' }),
    a(18, 46, '198.51.100.34', true, { tenantId: '2', userId: '103', step: 'totp' }),
    a(17, 120, '198.51.100.99', false, { tenantId: '4', userId: '105', failureReason: 'conta_suspensa' }),
    a(16, 200, '198.51.100.10', true, { userId: '900' }),
    a(15, 300, '198.51.100.57', false, { tenantId: '3', userId: '104', failureReason: 'usuario_inativo' }),
  ];
};

const seedFlagged = (): FlaggedIp[] => [
  { ipAddress: '203.0.113.45', failures: 9, successes: 0, distinctAccounts: 4, firstSeenAt: '2026-11-21T12:30:00.000Z', lastSeenAt: '2026-11-21T12:56:00.000Z', flagged: true, reasons: ['muitas_falhas', 'muitas_contas'] },
  { ipAddress: '198.51.100.99', failures: 3, successes: 0, distinctAccounts: 1, firstSeenAt: '2026-11-21T10:50:00.000Z', lastSeenAt: '2026-11-21T11:00:00.000Z', flagged: false, reasons: [] },
];

interface Db {
  tenants: TenantRow[];
  audit: AuditLogDetail[];
  sessions: PortalSession[];
  attempts: LoginAttempt[];
  flagged: FlaggedIp[];
}

const seed = (): Db => ({ tenants: seedTenants(), audit: seedAudit(), sessions: seedSessions(), attempts: seedAttempts(), flagged: seedFlagged() });
let db = seed();
export const resetMockSuperAdmin = () => {
  db = seed();
};

const summarize = (t: TenantRow): Tenant => ({
  id: t.id, name: t.name, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt, suspendedAt: t.suspendedAt,
  suspensionReason: t.suspensionReason, counts: t.counts,
});
const find = (id: EntityId) => db.tenants.find((t) => t.id === id) ?? null;
const must = (id: EntityId) => find(id) ?? (() => { throw mockNotFound(); })();

const toAuditLog = (r: AuditLogDetail): AuditLog => ({
  id: r.id, tenantId: r.tenantId, tenantName: r.tenantName, userId: r.userId, userEmail: r.userEmail, entity: r.entity, entityId: r.entityId,
  action: r.action, reason: r.reason, createdAt: r.createdAt,
});

let auditSeq = 100;
function record(entry: Partial<AuditLogDetail> & Pick<AuditLogDetail, 'entity' | 'action'>) {
  db.audit.unshift({
    id: String(++auditSeq), tenantId: null, tenantName: null, userId: '900', userEmail: 'superadmin@exemplo.test', entityId: '0', reason: null,
    createdAt: NOW, before: null, after: null, ...entry,
  });
}

const FACTOR: Record<StatsWindow, number> = { '24h': 1, '7d': 6, '30d': 24 };
const DAYS: Record<StatsWindow, number> = { '24h': 1, '7d': 7, '30d': 30 };

const dayList = (window: StatsWindow, scale: number) =>
  Array.from({ length: DAYS[window] }, (_, i) => {
    const d = new Date(Date.parse(NOW) - (DAYS[window] - 1 - i) * 86_400_000);
    const weekend = [0, 6].includes(d.getUTCDay());
    return { day: d.toISOString().slice(0, 10), punches: Math.round(scale * (weekend ? 0.3 : 1) * (0.85 + ((i * 7) % 5) / 20)) };
  });

const usage = (window: StatsWindow, k = 1): ModuleUsage => ({
  adjustments: Math.round(41 * FACTOR[window] * k), certificates: Math.round(12 * FACTOR[window] * k), vacations: Math.round(9 * FACTOR[window] * k),
  absences: Math.round(7 * FACTOR[window] * k), closings: Math.round(3 * FACTOR[window] * k),
});

const overview = (window: StatsWindow): StatsOverview => {
  const active = db.tenants.filter((t) => t.status === 'ativa');
  const perDay = dayList(window, 1650);
  return {
    window,
    tenants: { total: db.tenants.length, active: active.length, suspended: db.tenants.length - active.length },
    employees: db.tenants.reduce((n, t) => n + t.counts.employees, 0),
    devices: { total: db.tenants.reduce((n, t) => n + t.counts.devices, 0), active: active.reduce((n, t) => n + t.counts.devices, 0) },
    users: db.tenants.reduce((n, t) => n + t.counts.users, 0),
    punches: perDay.reduce((n, d) => n + d.punches, 0),
    punchesPerDay: perDay,
    processedRate: 0.982,
    pendingClosings: 5,
    moduleUsage: usage(window),
    topTenants: active
      .map((t) => ({ tenantId: t.id, name: t.name, punches: Math.round(t.counts.employees * 3.4 * FACTOR[window]), employees: t.counts.employees }))
      .sort((a, b) => b.punches - a.punches),
  };
};

const tenantStats = (t: TenantRow, window: StatsWindow): TenantStats => {
  const perDay = dayList(window, t.counts.employees * 3.4);
  return {
    tenantId: t.id, window, employees: t.counts.employees, devices: { total: t.counts.devices, active: t.status === 'ativa' ? t.counts.devices : 0 },
    users: t.counts.users, punches: perDay.reduce((n, d) => n + d.punches, 0), punchesPerDay: perDay,
    processedRate: t.counts.employees > 100 ? 0.991 : null, pendingClosings: t.counts.establishments, moduleUsage: usage(window, t.counts.employees / 400),
  };
};

const growth = (months: number): GrowthPoint[] =>
  Array.from({ length: months }, (_, i) => {
    const n = months - 1 - i;
    const date = new Date(Date.UTC(2026, 10 - n, 1));
    const total = Math.max(1, 4 - Math.floor(n / 3));
    return {
      month: date.toISOString().slice(0, 7), newTenants: n % 3 === 0 ? 1 : 0, totalTenants: total,
      newEmployees: 30 + ((i * 17) % 40), totalEmployees: 300 + (months - n) * 62,
    };
  });

const health = (): SystemHealth => ({
  status: 'degraded', checkedAt: NOW, version: '0.14.0', uptimeSeconds: 864_000 + 5_400,
  checks: [
    { service: 'api', status: 'ok', latencyMs: 4, detail: null, metrics: null },
    { service: 'postgres_app', status: 'ok', latencyMs: 6, detail: null, metrics: { connections: 12 } },
    { service: 'postgres_arp', status: 'ok', latencyMs: 7, detail: null, metrics: { connections: 8 } },
    { service: 'valkey', status: 'ok', latencyMs: 2, detail: null, metrics: { punches: 0, postPunch: 3 } },
    { service: 'face_engine', status: 'degraded', latencyMs: 480, detail: 'Latência acima do esperado (480 ms).', metrics: { galleryCached: 1 } },
    { service: 'collector_api', status: 'ok', latencyMs: 9, detail: null, metrics: null },
    { service: 'rep_core', status: 'ok', latencyMs: null, detail: null, metrics: { pendingPunches: 0 } },
    { service: 'jobs', status: 'ok', latencyMs: null, detail: null, metrics: { pendingOutbox: 2 } },
  ],
});

const recognitionSummary = (window: StatsWindow): RecognitionSummary => {
  const punches = 1650 * DAYS[window];
  return {
    window, from: new Date(Date.parse(NOW) - DAYS[window] * 86_400_000).toISOString(), to: NOW, punches,
    byStatus: { pendente: 14, processado: Math.round(punches * 0.982), falhou: Math.round(punches * 0.008) },
    divergentClock: Math.round(punches * 0.004),
    recognitionScore: { avg: 1.42, p50: 1.45, p05: 1.08 }, livenessScore: { avg: 0.94, p50: 0.96, p05: 0.81 },
    livenessHistogram: [0, 0, 1, 2, 4, 9, 22, 61, 180, 721],
    notRecognized: null, livenessFailed: null, latencyP50Ms: null, latencyP95Ms: null,
  };
};

const recognitionSeries = (window: StatsWindow, bucket: 'hour' | 'day'): RecognitionSeriesPoint[] => {
  const count = bucket === 'hour' ? Math.min(24 * DAYS[window], 72) : DAYS[window];
  const step = bucket === 'hour' ? 3_600_000 : 86_400_000;
  return Array.from({ length: count }, (_, i) => {
    const t = new Date(Date.parse(NOW) - (count - 1 - i) * step);
    const base = bucket === 'hour' ? [6, 7, 11, 12, 13, 17, 18].includes(t.getUTCHours()) ? 160 : 12 : 1650;
    return { bucketStart: t.toISOString(), punches: base + ((i * 13) % 20), failed: i % 9 === 0 ? 2 : 0, avgRecognitionScore: 1.38 + (i % 5) / 100, avgLivenessScore: 0.93 + (i % 4) / 100 };
  });
};

const recognitionDevices = (): RecognitionDevice[] => [
  { tenantId: '1', establishmentId: '1', deviceId: '1', deviceName: 'Portaria principal', punches: 5210, failed: 31, divergentClock: 12, avgRecognitionScore: 1.44, avgLivenessScore: 0.95, lastPunchAt: '2026-11-21T12:58:00.000Z' },
  { tenantId: '1', establishmentId: '2', deviceId: '2', deviceName: 'Talhão 7', punches: 1840, failed: 40, divergentClock: 44, avgRecognitionScore: 1.29, avgLivenessScore: 0.9, lastPunchAt: '2026-11-21T09:12:00.000Z' },
  { tenantId: '2', establishmentId: '4', deviceId: '4', deviceName: 'Entrada da usina', punches: 3300, failed: 12, divergentClock: 3, avgRecognitionScore: 1.47, avgLivenessScore: 0.96, lastPunchAt: '2026-11-21T12:50:00.000Z' },
  { tenantId: '3', establishmentId: '5', deviceId: '5', deviceName: null, punches: 0, failed: 0, divergentClock: 0, avgRecognitionScore: null, avgLivenessScore: null, lastPunchAt: null },
];

const cursorPage = <T extends { id: EntityId }>(rows: T[], cursor: EntityId | undefined, limit = 25): CursorPage<T> => {
  // Ordem decrescente por id: o cursor é o id do último item da página anterior.
  const start = cursor ? rows.findIndex((r) => r.id === cursor) + 1 : 0;
  const data = rows.slice(start, start + limit);
  return { data, meta: { nextCursor: start + limit < rows.length ? (data[data.length - 1]?.id ?? null) : null, limit } };
};

const inRange = (iso: string, from?: string, to?: string) => (!from || iso >= from) && (!to || iso < to);

const detailOf = (t: TenantRow): TenantDetail => ({ ...summarize(t), companies: clone(t.companies), admins: clone(t.admins), hasCompanyKey: t.hasCompanyKey });

function randomPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 16 }, (_, i) => alphabet[(i * 7 + db.audit.length * 3 + 11) % alphabet.length]).join('');
}

export const mockSuperAdminApi: SuperAdminApi = {
  tenants: {
    list: async (q): Promise<Paged<Tenant>> => {
      await delay();
      const rows = db.tenants.filter((t) => (!q.status || t.status === q.status) && matchesQuery(q.q, t.name, ...t.companies.map((c) => c.legalName)));
      const page = paginate(rows.map(summarize), q);
      return clone(page);
    },
    get: async (id) => {
      await delay();
      return detailOf(must(id));
    },
    create: async (input) => {
      await delay(400);
      if (!isValidCnpj(input.company.cnpj)) throw mockFail(400, 'CNPJ_INVALIDO', 'CNPJ inválido');
      const email = input.admin.email.trim().toLowerCase();
      if (db.tenants.some((t) => t.admins.some((a) => a.email.toLowerCase() === email))) throw mockFail(409, 'EMAIL_IN_USE', 'E-mail já em uso');
      const adminId = mockId();
      const admin: TenantAdmin = { id: adminId, name: input.admin.name.trim(), email, role: 'admin', isActive: true, mfaEnabled: false };
      const company: TenantCompany = { id: mockId(), legalName: input.company.legalName.trim(), cnpj: onlyDigits(input.company.cnpj), isActive: true };
      const row: TenantRow = {
        id: mockId(), name: input.name.trim(), status: 'ativa', createdAt: NOW, updatedAt: NOW, suspendedAt: null, suspensionReason: null,
        counts: { employees: 0, devices: 0, users: 1, establishments: 1 }, hasCompanyKey: true, companies: [company], admins: [admin],
      };
      db.tenants.unshift(row);
      record({ entity: 'tenant', action: 'criacao', tenantId: row.id, tenantName: row.name, entityId: row.id, after: { nome: row.name } });
      return { tenant: detailOf(row), admin: { id: adminId, name: admin.name, email }, temporaryPassword: randomPassword() };
    },
    update: async (id, input) => {
      await delay();
      const t = must(id);
      const before = t.name;
      t.name = input.name.trim();
      t.updatedAt = NOW;
      record({ entity: 'tenant', action: 'alteracao', tenantId: t.id, tenantName: t.name, entityId: t.id, before: { nome: before }, after: { nome: t.name } });
      return detailOf(t);
    },
    suspend: async (id, reason) => {
      await delay();
      const t = must(id);
      if (t.status === 'suspensa') throw mockFail(409, 'TENANT_ALREADY_SUSPENDED', 'Conta já suspensa');
      t.status = 'suspensa';
      t.suspendedAt = NOW;
      t.suspensionReason = reason.trim();
      t.updatedAt = NOW;
      // Suspender derruba as sessões da conta.
      for (const s of db.sessions) if (s.tenantId === t.id) s.isActive = false;
      record({ entity: 'tenant', action: 'alteracao', tenantId: t.id, tenantName: t.name, entityId: t.id, reason: t.suspensionReason, before: { ativo: true }, after: { ativo: false } });
      return detailOf(t);
    },
    reactivate: async (id, reason) => {
      await delay();
      const t = must(id);
      if (t.status !== 'suspensa') throw mockFail(409, 'TENANT_NOT_SUSPENDED', 'Conta não está suspensa');
      t.status = 'ativa';
      t.suspendedAt = null;
      t.suspensionReason = null;
      t.updatedAt = NOW;
      record({ entity: 'tenant', action: 'alteracao', tenantId: t.id, tenantName: t.name, entityId: t.id, reason: reason.trim(), before: { ativo: false }, after: { ativo: true } });
      return detailOf(t);
    },
  },
  audit: {
    list: async (q) => {
      await delay();
      const rows = db.audit.filter((r) =>
        (!q.tenantId || r.tenantId === q.tenantId) && (!q.userId || r.userId === q.userId) && (!q.entity || r.entity === q.entity) &&
        (!q.action || r.action === q.action) && inRange(r.createdAt, q.from, q.to));
      return clone(cursorPage(rows.map(toAuditLog), q.cursor, q.limit));
    },
    get: async (id) => {
      await delay();
      const row = db.audit.find((r) => r.id === id);
      if (!row) throw mockNotFound();
      return clone(row);
    },
  },
  access: {
    sessions: async (q) => {
      await delay();
      const rows = db.sessions.filter((s) =>
        (!q.tenantId || s.tenantId === q.tenantId) && (!q.userId || s.userId === q.userId) && (!q.ip || s.ipAddress === q.ip) &&
        (q.active === undefined || s.isActive === q.active));
      return clone(paginate(rows, q));
    },
    loginAttempts: async (q) => {
      await delay();
      const rows = db.attempts.filter((a) =>
        (!q.ip || a.ipAddress === q.ip) && (!q.tenantId || a.tenantId === q.tenantId) && (q.success === undefined || a.success === q.success) && inRange(a.createdAt, q.from, q.to));
      return clone(cursorPage(rows, q.cursor, q.limit));
    },
    flaggedIps: async () => {
      await delay();
      return clone(db.flagged);
    },
    revokeSession: async (id) => {
      await delay();
      const s = db.sessions.find((x) => x.id === id);
      if (!s) throw mockNotFound();
      const revoked = s.isActive ? 1 : 0;
      s.isActive = false;
      record({ entity: 'session', action: 'exclusao', entityId: s.id, tenantId: s.tenantId, tenantName: s.tenantName, reason: 'Revogada pelo painel.' });
      return { revoked };
    },
    revokeUserSessions: async (userId) => {
      await delay();
      const mine = db.sessions.filter((s) => s.userId === userId && s.isActive);
      for (const s of mine) s.isActive = false;
      if (db.sessions.every((s) => s.userId !== userId)) throw mockNotFound();
      return { revoked: mine.length };
    },
  },
  recognition: {
    summary: async (q) => {
      await delay();
      return recognitionSummary(q.window ?? '24h');
    },
    series: async (q) => {
      await delay();
      return recognitionSeries(q.window ?? '24h', q.bucket);
    },
    devices: async (q) => {
      await delay();
      return clone(recognitionDevices().filter((d) => (!q.tenantId || d.tenantId === q.tenantId) && (!q.deviceId || d.deviceId === q.deviceId)));
    },
  },
  stats: {
    overview: async (window) => {
      await delay(300);
      return overview(window);
    },
    tenant: async (id, window) => {
      await delay();
      return tenantStats(must(id), window);
    },
    growth: async (months) => {
      await delay();
      return growth(months);
    },
  },
  health: {
    get: async () => {
      await delay(150);
      return health();
    },
  },
  auth2fa: {
    enable: async (password) => {
      await delay(300);
      if (!password) throw mockFail(400, 'INVALID_PASSWORD', 'Senha incorreta');
      return {
        totpURI: `otpauth://totp/Genus:superadmin%40exemplo.test?secret=${FAKE_TOTP_SECRET}&issuer=Genus`,
        backupCodes: ['a1b2c-d3e4f', 'g5h6i-j7k8l', 'm9n0p-q1r2s', 's3t4u-v5w6x', 'y7z8a-b9c0d', 'e1f2g-h3i4j', 'k5l6m-n7o8p', 'q9r0s-t1u2v'],
      };
    },
    verify: async (code) => {
      await delay(300);
      if (code !== MOCK_TOTP_CODE) throw mockFail(401, 'INVALID_TWO_FACTOR_CODE', 'Código inválido');
    },
  },
};
